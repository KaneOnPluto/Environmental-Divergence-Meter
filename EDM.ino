#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <Wire.h>
#include <bsec.h>
#include <BH1750.h>
#include <SPI.h>
#include <driver/i2s.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <HTTPClient.h>

#define TFT_CS 33
#define TFT_DC 25
#define TFT_RST 14

#define I2S_WS 27
#define I2S_SD 32
#define I2S_SCK 26

#define BG ILI9341_BLACK
#define ACCENT ILI9341_CYAN
#define HEADER ILI9341_DARKGREEN
#define TEXT ILI9341_WHITE

Adafruit_ILI9341 tft = Adafruit_ILI9341(TFT_CS, TFT_DC, TFT_RST);

Bsec iaqSensor;
BH1750 lightMeter;

unsigned long startTime = 0;

const unsigned long BURN_IN_TIME = 24UL * 60UL * 60UL * 1000UL;
bool isBurnInComplete = false;

float temp = 0;
float humidity = 0;
float divergence = 0;
float smoothedDivergence = 0;

const char* ssid = "WIFI_ID";
const char* password = "WIFI_PASSWORD";

const char* supabaseUrl = "supabase_url";
const char* supabaseKey = "supabase_key";

unsigned long lastSupabaseSend = 0;
const unsigned long sendInterval = 60000;

float iaq = 0;
int sound = 0;
int lux = 0;

float alpha = 0.2;

int scanX = 20;
int lastSegments = 0;

Preferences preferences;

bool bsecStateLoaded = false;

uint8_t bsecState[BSEC_MAX_STATE_BLOB_SIZE];

unsigned long lastStateSave = 0;
const unsigned long STATE_SAVE_INTERVAL = 600000;  // 10 min


// ================= WORLD =================

String getWorldLine(float d) {
  if (d < 0.30) return "ALPHA";
  if (d < 0.60) return "BETA";
  if (d < 0.90) return "GAMMA";
  return "STEINS"; // Steins Gate IS GOAT
}

uint16_t getWorldColor(String w) {
  if (w == "ALPHA") return ILI9341_RED;
  if (w == "BETA") return ILI9341_ORANGE;
  if (w == "GAMMA") return ILI9341_YELLOW;
  return ILI9341_GREEN;
}


// ================= MIC =================

void setupMic() {

  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = 44100,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_I2S_MSB,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = 256,
    .use_apll = false
  };

  i2s_pin_config_t pins = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = -1,
    .data_in_num = I2S_SD
  };

  i2s_driver_install(I2S_NUM_0, &config, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pins);
}

void loadBsecState() {

  preferences.begin("bsec", true);  // read-only

  size_t len = preferences.getBytesLength("state");

  if (len == BSEC_MAX_STATE_BLOB_SIZE) {

    preferences.getBytes("state", bsecState, len);
    iaqSensor.setState(bsecState);

    bsecStateLoaded = true;
    Serial.println("BSEC state loaded");
  } else {
    Serial.println("No valid BSEC state found");
  }

  preferences.end();
}

void saveBsecState() {

  if (iaqSensor.iaqAccuracy < 2) return;

  preferences.begin("bsec", false);

  iaqSensor.getState(bsecState);

  preferences.putBytes("state", bsecState, BSEC_MAX_STATE_BLOB_SIZE);

  preferences.end();

  Serial.println("BSEC state saved");
}


// ================= SERVER =================

WebServer server(80);

int readSoundLevel() {

  int32_t sample = 0;
  size_t bytes;

  long sum = 0;

  for (int i = 0; i < 200; i++) {
    i2s_read(I2S_NUM_0, &sample, sizeof(sample), &bytes, portMAX_DELAY);
    sample >>= 14;
    sum += sample * sample;
  }

  float rms = sqrt(sum / 200);

  int level = rms / 50;

  return constrain(level, 0, 100);
}


// ================= UI =================

void drawLayout() {

  tft.fillScreen(BG);

  tft.fillRect(0, 0, 320, 28, HEADER);

  tft.setTextColor(BG);
  tft.setTextSize(2);
  tft.setCursor(25, 6);
  tft.print("ENVIRONMENTAL DIVERGENCE");

  tft.setTextColor(ACCENT);
  tft.setTextSize(1);

  tft.drawRect(10, 45, 95, 40, HEADER);
  tft.drawRect(115, 45, 95, 40, HEADER);
  tft.drawRect(220, 45, 90, 40, HEADER);

  tft.drawRect(10, 90, 95, 40, HEADER);
  tft.drawRect(115, 90, 95, 40, HEADER);
  tft.drawRect(220, 90, 90, 40, HEADER);

  tft.setCursor(15, 50);
  tft.print("TEMP");
  tft.setCursor(120, 50);
  tft.print("HUMIDITY");
  tft.setCursor(225, 50);
  tft.print("LUX");

  tft.setCursor(15, 95);
  tft.print("IAQ");
  tft.setCursor(120, 95);
  tft.print("NOISE");
  tft.setCursor(225, 95);
  tft.print("WORLD");

  tft.drawLine(0, 150, 320, 150, HEADER);

  tft.setCursor(20, 160);
  tft.print("DIVERGENCE");
}


// ================= NETWORK =================

void sendToSupabase() {

  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;

  http.begin(supabaseUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", supabaseKey);
  http.addHeader("Authorization", String("Bearer ") + supabaseKey);
  http.addHeader("Prefer", "return=minimal");

  String payload = "{";
  payload += "\"temperature\":" + String(temp, 1) + ",";
  payload += "\"humidity\":" + String(humidity, 0) + ",";
  payload += "\"gas\":" + String(iaq) + ",";
  payload += "\"light\":" + String(lux) + ",";
  payload += "\"sound\":" + String(sound) + ",";
  payload += "\"divergence\":" + String(divergence, 6);
  payload += "}";

  int httpResponseCode = http.POST(payload);

  Serial.print("Supabase Response: ");
  Serial.println(httpResponseCode);

  http.end();
}

void handleData() {
  String json = "{";
  json += "\"temperature\":" + String(temp, 1) + ",";
  json += "\"humidity\":" + String(humidity, 0) + ",";
  json += "\"iaq\":" + String(iaq) + ",";
  json += "\"lux\":" + String(lux) + ",";
  json += "\"sound\":" + String(sound) + ",";
  json += "\"divergence\":" + String(divergence, 6);
  json += "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}


// ================= DISPLAY UPDATE =================

void updateValues() {

  tft.setTextColor(TEXT, BG);
  tft.setTextSize(2);

  tft.setCursor(15, 65);
  tft.print(String(temp, 1) + " C ");

  tft.setCursor(120, 65);
  tft.print(String(humidity, 0) + " % ");

  tft.setCursor(225, 65);
  tft.print(String(lux) + " lx");

  tft.setCursor(15, 110);

  // IAQ STATE
  if (iaqSensor.iaqAccuracy == 0) {
    tft.print(String((int)iaq) + "* ");  // show value
  } else if (iaqSensor.iaqAccuracy == 1) {
    tft.print("CAL  ");
  } else {
    tft.print(String((int)iaq) + "  ");
  }

  tft.setCursor(120, 110);
  tft.print(String(sound) + "  ");

  String world = getWorldLine(divergence);

  tft.setTextColor(getWorldColor(world), BG);
  tft.setCursor(225, 110);
  tft.print(world + " ");

  tft.setTextSize(4);

  tft.setTextColor(ILI9341_DARKGREEN, BG);
  tft.setCursor(22, 185);
  tft.print(String(divergence, 6));

  tft.setTextColor(TEXT, BG);
  tft.setCursor(20, 183);
  tft.print(String(divergence, 6));

  // ===== BSEC STATE INDICATOR =====
  tft.setTextSize(1);
  tft.setCursor(10, 230);

  if (bsecStateLoaded) {
    tft.setTextColor(ILI9341_GREEN, BG);
    tft.print("STATE: LOADED ");
  } else {
    tft.setTextColor(ILI9341_RED, BG);
    tft.print("STATE: NEW    ");
  }
}


// ================= VISUAL =================

void drawGauge() {
  int barX = 20;
  int barY = 215;
  int segW = 12;
  int gap = 2;
  int segments = 20;

  int active = divergence * segments;

  uint16_t color;

  if (divergence < 0.30) color = ILI9341_RED;
  else if (divergence < 0.60) color = ILI9341_ORANGE;
  else if (divergence < 0.90) color = ILI9341_YELLOW;
  else color = ILI9341_GREEN;

  for (int i = 0; i < segments; i++) {
    int x = barX + i * (segW + gap);

    if (i < active)
      tft.fillRect(x, barY, segW, 12, color);
    else
      tft.fillRect(x, barY, segW, 12, BG);

    tft.drawRect(x, barY, segW, 12, HEADER);
  }
}

void drawScanner() {
  int y = 235;

  tft.drawFastHLine(scanX, y, 10, BG);

  scanX += 6;
  if (scanX > 300) scanX = 20;

  tft.drawFastHLine(scanX, y, 10, ACCENT);
}


// ================= SETUP =================

void setup() {

  Serial.begin(115200);

  startTime = millis();

  Wire.begin(21, 22);

  iaqSensor.begin(BME68X_I2C_ADDR_LOW, Wire);

  if (iaqSensor.bsecStatus != BSEC_OK) {
    Serial.println("BSEC init failed");
  }

  bsec_virtual_sensor_t sensorList[] = {
    BSEC_OUTPUT_IAQ,
    BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_TEMPERATURE,
    BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_HUMIDITY
  };

  iaqSensor.updateSubscription(sensorList, 3, BSEC_SAMPLE_RATE_ULP);

  loadBsecState();

  lightMeter.begin();

  tft.begin();
  tft.setRotation(1);

  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi connected");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  server.on("/data", handleData);
  server.begin();

  setupMic();
  drawLayout();
}


// ================= LOOP =================

void loop() {

  server.handleClient();

  if (!iaqSensor.run()) {
    Serial.println(iaqSensor.bsecStatus);
  } else {
    temp = iaqSensor.temperature;
    humidity = iaqSensor.humidity;
    iaq = iaqSensor.iaq;
  }

  bool timeBurnIn = (millis() - startTime > BURN_IN_TIME);
  bool sensorReady = (iaqSensor.iaqAccuracy >= 2);

  isBurnInComplete = timeBurnIn || sensorReady;

  lux = max(0, (int)lightMeter.readLightLevel());
  sound = readSoundLevel();

  float T = constrain((temp - 20.0) / 15.0, 0, 1);
  float H = constrain(1.0 - abs(humidity - 50.0) / 50.0, 0, 1);
  float G = constrain(1.0 - (iaq / 300.0), 0, 1);
  float S = constrain(1.0 - (sound / 100.0), 0, 1);
  float L = constrain(1.0 - abs(lux - 300.0) / 700.0, 0, 1);

  float raw = 0.30 * T + 0.25 * G + 0.20 * H + 0.15 * S + 0.10 * L;

  smoothedDivergence = alpha * raw + (1 - alpha) * smoothedDivergence;
  divergence = smoothedDivergence;

  updateValues();
  drawGauge();
  drawScanner();

  if (millis() > 300000 && millis() - lastStateSave > STATE_SAVE_INTERVAL) {
    saveBsecState();
    lastStateSave = millis();
  }

  if (millis() - lastSupabaseSend > sendInterval) {
    sendToSupabase();
    lastSupabaseSend = millis();
  }

  delay(1000);
}
