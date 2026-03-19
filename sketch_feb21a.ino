#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <Wire.h>
#include <Adafruit_BME680.h>
#include <BH1750.h>
#include <SPI.h>
#include <driver/i2s.h>

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

Adafruit_BME680 bme;
BH1750 lightMeter;

float temp = 0;
float humidity = 0;
float divergence = 0;
float smoothedDivergence = 0;

int iaq = 0;
int sound = 0;
int lux = 0;

float alpha = 0.2;

int scanX = 20;
int lastSegments = 0;

String getWorldLine(float d) {
  if (d < 0.30) return "ALPHA";
  if (d < 0.60) return "BETA";
  if (d < 0.90) return "GAMMA";
  return "STEINS";
}

uint16_t getWorldColor(String w) {
  if (w == "ALPHA") return ILI9341_RED;
  if (w == "BETA") return ILI9341_ORANGE;
  if (w == "GAMMA") return ILI9341_YELLOW;
  return ILI9341_GREEN;
}

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
  tft.print(String(iaq) + "  ");

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
}

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

  int m1 = barX + (segments * 0.30) * (segW + gap);
  int m2 = barX + (segments * 0.60) * (segW + gap);
  int m3 = barX + (segments * 0.90) * (segW + gap);

  tft.drawFastVLine(m1, barY - 4, 20, ACCENT);
  tft.drawFastVLine(m2, barY - 4, 20, ACCENT);
  tft.drawFastVLine(m3, barY - 4, 20, ACCENT);
}

void drawScanner() {

  int y = 235;

  tft.drawFastHLine(scanX, y, 10, BG);

  scanX += 6;

  if (scanX > 300) scanX = 20;

  tft.drawFastHLine(scanX, y, 10, ACCENT);
}

void setup() {

  Serial.begin(115200);

  Wire.begin(21, 22);

  bme.begin(0x76);
  lightMeter.begin();

  tft.begin();
  tft.setRotation(1);

  setupMic();

  drawLayout();
}

void loop() {

  if (!bme.performReading()) return;

  temp = bme.temperature;
  humidity = bme.humidity;
  iaq = bme.gas_resistance / 100;

  lux = lightMeter.readLightLevel();
  sound = readSoundLevel();

  float T = temp / 40.0;
  float H = humidity / 100.0;
  float G = iaq / 500.0;
  float S = 1.0 - (sound / 100.0);
  float L = lux / 1000.0;

  T = constrain(T, 0, 1);
  H = constrain(H, 0, 1);
  G = constrain(G, 0, 1);
  S = constrain(S, 0, 1);
  L = constrain(L, 0, 1);

  float raw = 0.30 * T + 0.25 * G + 0.20 * H + 0.15 * S + 0.10 * L;

  smoothedDivergence = alpha * raw + (1 - alpha) * smoothedDivergence;

  divergence = smoothedDivergence;

  updateValues();
  drawGauge();
  drawScanner();

  delay(500);
}