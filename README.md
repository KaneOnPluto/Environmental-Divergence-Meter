# Environmental Divergence Meter (EDM)

Environmental Divergence Meter is an ESP32-based environmental monitoring system that measures temperature, humidity, indoor air quality, illuminance, and sound, combines the measurements into a normalized scalar divergence value, displays the result locally, and exposes the current state over HTTP.

The current firmware also supports persistent BSEC state, periodic Supabase transmission, and world-line classification based on the final divergence value.

## Table of Contents

- [1. System Overview](#1-system-overview)
- [2. Hardware](#2-hardware)
  - [2.1 ESP32](#21-esp32)
  - [2.2 BME688](#22-bme688)
  - [2.3 BH1750](#23-bh1750)
  - [2.4 INMP441](#24-inmp441)
  - [2.5 ILI9341 TFT](#25-ili9341-tft)
- [3. Pin Configuration](#3-pin-configuration)
- [4. Sensor Acquisition](#4-sensor-acquisition)
  - [4.1 BME688 / BSEC](#41-bme688--bsec)
  - [4.2 BH1750](#42-bh1750)
  - [4.3 INMP441 Sound Processing](#43-inmp441-sound-processing)
- [5. Divergence Model](#5-divergence-model)
- [6. Normalization Functions](#6-normalization-functions)
  - [6.1 Temperature](#61-temperature)
  - [6.2 Humidity](#62-humidity)
  - [6.3 IAQ](#63-iaq)
  - [6.4 Sound](#64-sound)
  - [6.5 Illuminance](#65-illuminance)
- [7. Weighted Raw Score](#7-weighted-raw-score)
- [8. Temporal Smoothing](#8-temporal-smoothing)
- [9. Complete Mathematical Formula](#9-complete-mathematical-formula)
- [10. Example Calculation](#10-example-calculation)
- [11. Effect of Smoothing](#11-effect-of-smoothing)
- [12. EMA Response](#12-ema-response)
- [13. World-Line Classification](#13-world-line-classification)
- [14. Divergence Bounds](#14-divergence-bounds)
- [15. Model Interpretation](#15-model-interpretation)
- [16. Important Properties of the Current Temperature Model](#16-important-properties-of-the-current-temperature-model)
- [17. BSEC State Persistence](#17-bsec-state-persistence)
- [18. Burn-In / Sensor Readiness](#18-burn-in--sensor-readiness)
- [19. Display](#19-display)
- [20. HTTP API](#20-http-api)
- [21. Supabase Transmission](#21-supabase-transmission)
- [22. Network Configuration](#22-network-configuration)
- [23. Full Processing Algorithm](#23-full-processing-algorithm)
- [24. Mathematical Specification](#24-mathematical-specification)
- [25. Implementation Reference](#25-implementation-reference)
- [26. Model Versioning](#26-model-versioning)
- [27. Current Parameter Set](#27-current-parameter-set)
- [28. Limitations of the Current Model](#28-limitations-of-the-current-model)
- [29. Repository Reference](#29-repository-reference)
- [30. Summary](#30-summary)

---

## 1. System Overview

The system consists of:

- **ESP32** — main controller, Wi-Fi connectivity, web server, display control, and data processing
- **BME688** — temperature, relative humidity, and BSEC IAQ
- **BH1750** — illuminance in lux
- **INMP441** — digital microphone used to derive the firmware sound level
- **2.4-inch ILI9341 TFT** — local display
- **Supabase** — optional remote storage
- **EDM-App** — external React/Expo application that can read the ESP32 `/data` endpoint and display historical Supabase data

The firmware processes the measurements using the following pipeline:

```text
Sensors
   |
   +--> Temperature
   +--> Humidity
   +--> IAQ
   +--> Illuminance
   +--> Sound
             |
             v
      Normalization [0, 1]
             |
             v
       Weighted Sum
             |
             v
        Raw Score R
             |
             v
      Exponential Smoothing
             |
             v
      Divergence D [0, 1]
             |
       +-----+-----+
       |           |
       v           v
   World-line    Network
 classification   output
```

---

## 2. Hardware

### 2.1 ESP32

The ESP32 is the main processing and networking device.

It is responsible for:

- Reading the BME688 through BSEC
- Reading the BH1750
- Reading the INMP441 through I2S
- Calculating divergence
- Driving the ILI9341 display
- Running the HTTP server
- Sending data to Supabase
- Persisting BSEC state in non-volatile storage

---

### 2.2 BME688

The BME688 is used through the **BSEC** library.

The firmware subscribes to:

```cpp
BSEC_OUTPUT_IAQ
BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_TEMPERATURE
BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_HUMIDITY
```

Therefore the divergence model uses:

- heat-compensated temperature
- heat-compensated relative humidity
- BSEC IAQ

The IAQ variable in the model is the BSEC IAQ output, not a raw gas-resistance measurement.

---

### 2.3 BH1750

The BH1750 provides illuminance in lux.

The firmware stores the measurement in:

```cpp
int lux;
```

The value is incorporated into the divergence model through the light normalization function.

---

### 2.4 INMP441

The INMP441 is connected using I2S.

The firmware configures:

```cpp
.mode = I2S_MODE_MASTER | I2S_MODE_RX
.sample_rate = 44100
.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT
.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT
```

The microphone is sampled 200 times for each sound measurement.

The firmware does not perform a calibrated SPL conversion to physical decibels. The resulting `sound` variable is a firmware-defined level from 0 to 100.

---

### 2.5 ILI9341 TFT

The display is an ILI9341-based TFT.

It is used to display:

- Temperature
- Humidity
- Lux
- IAQ
- Sound
- World line
- Divergence
- BSEC state
- Divergence gauge
- Scanner animation

The display is not part of the mathematical model; it is an output device.

---

## 3. Pin Configuration

The current firmware defines:

```cpp
#define TFT_CS 33
#define TFT_DC 25
#define TFT_RST 14

#define I2S_WS 27
#define I2S_SD 32
#define I2S_SCK 26
```

The I2C bus is initialized with:

```cpp
Wire.begin(21, 22);
```

Therefore the current firmware uses:

| Function | ESP32 pin |
|---|---:|
| TFT CS | GPIO 33 |
| TFT DC | GPIO 25 |
| TFT RST | GPIO 14 |
| I2S WS | GPIO 27 |
| I2S SD | GPIO 32 |
| I2S SCK | GPIO 26 |
| I2C SDA | GPIO 21 |
| I2C SCL | GPIO 22 |

The BME688 and BH1750 share the I2C bus.

The BME688 is initialized using:

```cpp
iaqSensor.begin(BME68X_I2C_ADDR_LOW, Wire);
```

---

## 4. Sensor Acquisition

### 4.1 BME688 / BSEC

During the main loop, the firmware executes:

```cpp
if (!iaqSensor.run()) {
  Serial.println(iaqSensor.bsecStatus);
} else {
  temp = iaqSensor.temperature;
  humidity = iaqSensor.humidity;
  iaq = iaqSensor.iaq;
}
```

Thus:

```math
T = \text{temperature}
```

```math
H = \text{relative humidity}
```

```math
G = \text{BSEC IAQ}
```

These values are then passed to the divergence engine.

---

### 4.2 BH1750

The light level is read using:

```cpp
lux = max(0, (int)lightMeter.readLightLevel());
```

Therefore the model receives:

```math
L = \max(0,\text{BH1750 lux})
```

---

### 4.3 INMP441 Sound Processing

The sound routine collects 200 samples.

For every sample:

```cpp
sample >>= 14;
sum += sample * sample;
```

The firmware then calculates:

```cpp
float rms = sqrt(sum / 200);
int level = rms / 50;
return constrain(level, 0, 100);
```

Let the shifted samples be:

```math
x_1,x_2,\ldots,x_N
```

where:

```math
N=200
```

The RMS quantity used by the firmware is:

```math
RMS =
\sqrt{
\frac{1}{N}
\sum_{i=1}^{N}x_i^2
}
```

The firmware sound level is approximately:

```math
S_{\text{raw}}
=
\mathrm{clamp}
\left(
\frac{RMS}{50},
0,
100
\right)
```

where:

```math
\mathrm{clamp}(x,a,b)
=
\min(\max(x,a),b)
```

The resulting `sound` value is then used by the divergence model.

> [!IMPORTANT]
> The current firmware does **not** establish that this value is calibrated to dB SPL.
> It should therefore be treated as a firmware-specific sound index, not as a laboratory-calibrated acoustic measurement.

The sound index lies in the interval:

```math
0\le S_{\text{raw}}\le100
```

---

## 5. Divergence Model

The divergence engine has two mathematical stages:

1. Normalize every sensor variable to the range $[0,1]$.
2. Combine the normalized values using fixed weights.

The raw divergence score is:

```math
R_t
=
0.30T_n
+
0.25G_n
+
0.20H_n
+
0.15S_n
+
0.10L_n
```

The coefficients sum to one:

```math
0.30+0.25+0.20+0.15+0.10=1
```

Therefore the raw score is bounded by:

```math
0\le R_t\le1
```

provided that every normalized input is itself bounded to $[0,1]$.

---

## 6. Normalization Functions

The firmware uses `constrain()` for every normalized quantity.

For clarity, define:

```math
C(x)=\min(1,\max(0,x))
```

This is the mathematical equivalent of:

```cpp
constrain(x, 0, 1)
```

---

### 6.1 Temperature

Firmware:

```cpp
float T = constrain((temp - 20.0) / 15.0, 0, 1);
```

Mathematical form:

```math
\boxed{
T_n=C\left(\frac{T-20}{15}\right)
}
```

Piecewise:

```math
T_n=0,\quad T\le20
```

```math
T_n=\dfrac{T-20}{15},\quad 20<T<35
```

```math
T_n=1,\quad T\ge35
```

This function increases with temperature.

Its slope in the linear region is:

```math
\frac{\partial T_n}{\partial T}
=
\frac{1}{15}
```

Because temperature has a 30% weight, the raw divergence sensitivity in this region is:

```math
\frac{\partial R}{\partial T}
=
0.30\cdot\frac{1}{15}
=
0.02
```

---

### 6.2 Humidity

Firmware:

```cpp
float H = constrain(1.0 - abs(humidity - 50.0) / 50.0, 0, 1);
```

Mathematical form:

```math
\boxed{
H_n=
C\left(
1-\frac{|H-50|}{50}
\right)
}
```

This creates a triangular response centered at 50% relative humidity.

At:

```math
H=50
```

the normalized score is:

```math
H_n=1
```

At 0% or 100%:

```math
H_n=0
```

for the normal physical humidity range.

---

### 6.3 IAQ

Firmware:

```cpp
float G = constrain(1.0 - (iaq / 300.0), 0, 1);
```

Mathematical form:

```math
\boxed{
G_n=
C\left(
1-\frac{G}{300}
\right)
}
```

Piecewise:

```math
G_n=1,\quad G\le0
```

```math
G_n=1-\dfrac{G}{300},\quad 0<G<300
```

```math
G_n=0,\quad G\ge300
```

Therefore higher IAQ values reduce the normalized contribution.

Within the linear range:

```math
\frac{\partial G_n}{\partial G}
=
-\frac{1}{300}
```

and therefore:

```math
\frac{\partial R}{\partial G}
=
0.25\left(-\frac{1}{300}\right)
=
-\frac{1}{1200}
```

---

### 6.4 Sound

Firmware:

```cpp
float S = constrain(1.0 - (sound / 100.0), 0, 1);
```

Mathematical form:

```math
\boxed{
S_n=
C\left(
1-\frac{S}{100}
\right)
}
```

Piecewise:

```math
S_n=1,\quad S\le0
```

```math
S_n=1-\dfrac{S}{100},\quad 0<S<100
```

```math
S_n=0,\quad S\ge100
```

The raw score sensitivity in the linear range is:

```math
\frac{\partial R}{\partial S}
=
0.15\left(-\frac{1}{100}\right)
=
-0.0015
```

---

### 6.5 Illuminance

Firmware:

```cpp
float L = constrain(1.0 - abs(lux - 300.0) / 700.0, 0, 1);
```

Mathematical form:

```math
\boxed{
L_n=
C\left(
1-\frac{|L-300|}{700}
\right)
}
```

The maximum occurs at:

```math
L=300\text{ lux}
```

At this point:

```math
L_n=1
```

The absolute slope away from the center is:

```math
\left|
\frac{\partial L_n}{\partial L}
\right|
=
\frac{1}{700}
```

and the corresponding raw-score sensitivity is:

```math
\left|
\frac{\partial R}{\partial L}
\right|
=
0.10\cdot\frac{1}{700}
=
\frac{1}{7000}
```

for each linear branch.

---

## 7. Weighted Raw Score

After normalization, the firmware calculates:

```cpp
float raw =
  0.30 * T +
  0.25 * G +
  0.20 * H +
  0.15 * S +
  0.10 * L;
```

These variables are already normalized at this point.

Therefore:

```math
\boxed{
R_t=
0.30T_n+
0.25G_n+
0.20H_n+
0.15S_n+
0.10L_n
}
```

The maximum possible contribution from each component is:

| Component | Weight | Maximum contribution |
|---|---:|---:|
| Temperature | 0.30 | 0.30 |
| IAQ | 0.25 | 0.25 |
| Humidity | 0.20 | 0.20 |
| Sound | 0.15 | 0.15 |
| Light | 0.10 | 0.10 |
| **Total** | **1.00** | **1.00** |

Thus:

```math
0\le R_t\le1
```

---

## 8. Temporal Smoothing

The firmware defines:

```cpp
float alpha = 0.2;
```

and calculates:

```cpp
smoothedDivergence =
    alpha * raw +
    (1 - alpha) * smoothedDivergence;

divergence = smoothedDivergence;
```

Therefore:

```math
\boxed{
D_t
=
0.2R_t
+
0.8D_{t-1}
}
```

where:

- $R_t$ is the current raw score.
- $D_{t-1}$ is the previous smoothed divergence.
- $D_t$ is the current final divergence.

This is a first-order exponential moving average.

It prevents the displayed divergence from responding instantaneously to every sensor fluctuation.

---

## 9. Complete Mathematical Formula

Substituting the normalization functions into the raw score:

```math
\begin{aligned}
R_t={}&
0.30C\left(\frac{T-20}{15}\right)
+
0.25C\left(1-\frac{G}{300}\right)
\\
&+
0.20C\left(1-\frac{|H-50|}{50}\right)
+
0.15C\left(1-\frac{S}{100}\right)
\\
&+
0.10C\left(1-\frac{|L-300|}{700}\right)
\end{aligned}
```

The final divergence is:

```math
\boxed{
D_t=0.2R_t+0.8D_{t-1}
}
```

Combining both expressions:

```math
\begin{aligned}
D_t={}&0.2
\Bigg[
0.30C\left(\frac{T-20}{15}\right)
+
0.25C\left(1-\frac{G}{300}\right)
\\
&+
0.20C\left(1-\frac{|H-50|}{50}\right)
+
0.15C\left(1-\frac{S}{100}\right)
\\
&+
0.10C\left(1-\frac{|L-300|}{700}\right)
\Bigg]
+
0.8D_{t-1}
\end{aligned}
```

This is the mathematical definition of the current firmware implementation.

---

## 10. Example Calculation

Assume the following sensor measurements:

| Input | Value |
|---|---:|
| Temperature | 25 °C |
| Humidity | 50 % |
| IAQ | 50 |
| Sound | 30 |
| Light | 300 lux |

#### Temperature

```math
T_n=
\frac{25-20}{15}
=
0.3333
```

#### Humidity

```math
H_n=
1-\frac{|50-50|}{50}
=
1
```

#### IAQ

```math
G_n=
1-\frac{50}{300}
=
0.8333
```

#### Sound

```math
S_n=
1-\frac{30}{100}
=
0.70
```

#### Light

```math
L_n=
1-\frac{|300-300|}{700}
=
1
```

The weighted raw score is therefore:

```math
\begin{aligned}
R_t
&=
0.30(0.3333)
+
0.25(0.8333)
+
0.20(1)
\\
&\quad+
0.15(0.70)
+
0.10(1)
\\
&\approx
0.7133
\end{aligned}
```

So:

```math
\boxed{R_t\approx0.7133}
```

---

## 11. Effect of Smoothing

Suppose the previous divergence is:

```math
D_{t-1}=0
```

Then:

```math
D_t
=
0.2(0.7133)+0.8(0)
```

giving:

```math
\boxed{
D_t\approx0.1427
}
```

Therefore the first output after initialization is much smaller than the raw score.

For repeated identical input $R$ (so $R_t=R$ for every $t$):

```math
D_t
=
R(1-0.8^t)
```

when $D_0=0$.

This means the divergence approaches the raw score exponentially.

---

## 12. EMA Response

For a constant raw score:

```math
D_t=R(1-0.8^t)
```

The remaining error after $t$ updates is:

```math
|R-D_t|
=
|R-D_0|0.8^t
```

The half-life is found from:

```math
0.8^t=0.5
```

so:

```math
t=
\frac{\ln(0.5)}{\ln(0.8)}
\approx3.11
```

Thus the filter reaches approximately half of a step change after 3.1 updates.

The firmware loop contains:

```cpp
delay(1000);
```

so the update interval is approximately one second, excluding execution overhead.

A 95% response level satisfies:

```math
0.8^t=0.05
```

which gives:

```math
t\approx13.4
```

So a large step change takes roughly 13–14 update cycles to settle to within 5% of its final value.

---

## 13. World-Line Classification

The firmware maps the final divergence value to a world line:

```cpp
if (d < 0.30) return "ALPHA";
if (d < 0.60) return "BETA";
if (d < 0.90) return "GAMMA";
return "STEINS";
```

Mathematically:

```math
W(D)=\text{ALPHA},\quad 0\le D<0.30
```

```math
W(D)=\text{BETA},\quad 0.30\le D<0.60
```

```math
W(D)=\text{GAMMA},\quad 0.60\le D<0.90
```

```math
W(D)=\text{STEINS},\quad 0.90\le D\le1
```

The thresholds are applied **after** the EMA.

Therefore the world line is based on $D_t$, not directly on $R_t$.

---

## 14. Divergence Bounds

Every normalized quantity is clamped to:

```math
[0,1]
```

The weighted coefficients are non-negative and sum to one.

Therefore:

```math
0\le R_t\le1
```

The final divergence is a convex combination:

```math
D_t=0.2R_t+0.8D_{t-1}
```

If:

```math
0\le D_{t-1}\le1
```

then:

```math
0\le D_t\le1
```

The initial value is:

```cpp
float divergence = 0;
float smoothedDivergence = 0;
```

so:

```math
D_0=0
```

and the bounded interval is maintained by the recurrence.

---

## 15. Model Interpretation

The current implementation should be understood as a **weighted environmental score** whose result is named "divergence" by the project.

It is not a distance metric in the strict mathematical sense.

In particular:

- Temperature is modeled with a monotonically increasing function.
- Humidity is modeled as distance from 50%.
- IAQ is modeled as a monotonically decreasing function.
- Sound is modeled as a monotonically decreasing function.
- Light is modeled as distance from 300 lux.
- The final score is smoothed over time.

This distinction matters when comparing the EDM model with external environmental quality standards.

---

## 16. Important Properties of the Current Temperature Model

The current implementation is:

```math
T_n=C\left(\frac{T-20}{15}\right)
```

This means:

```math
T\le20 \Rightarrow T_n=0
```

and:

```math
T\ge35 \Rightarrow T_n=1
```

Therefore, within the current mathematical model, a higher temperature produces a higher temperature contribution.

For example:

```math
T=25
\Rightarrow
T_n=\frac{5}{15}\approx0.3333
```

while:

```math
T=35
\Rightarrow
T_n=1
```

This is a direct property of the implemented firmware and should not be interpreted as a validated definition of thermal comfort.

Any future change to make temperature an optimum-centered function would constitute a different EDM model.

---

## 17. BSEC State Persistence

The firmware stores the BSEC state using ESP32 `Preferences`.

The state is loaded during startup:

```cpp
loadBsecState();
```

and periodically saved when the BSEC accuracy requirement is met.

The firmware checks:

```cpp
if (iaqSensor.iaqAccuracy < 2) return;
```

before saving.

The state-save interval is:

```cpp
const unsigned long STATE_SAVE_INTERVAL = 600000;
```

which corresponds to:

```math
600000\text{ ms}=10\text{ minutes}
```

The BSEC state is therefore persistent across restarts, assuming a valid stored state exists.

---

## 18. Burn-In / Sensor Readiness

The firmware defines:

```cpp
const unsigned long BURN_IN_TIME =
    24UL * 60UL * 60UL * 1000UL;
```

Therefore:

```math
24\text{ hours}=86\,400\,000\text{ ms}
```

The firmware also checks:

```cpp
bool sensorReady = (iaqSensor.iaqAccuracy >= 2);
```

and stores:

```cpp
isBurnInComplete = timeBurnIn || sensorReady;
```

However, the current divergence calculation does not use `isBurnInComplete` as a gate.

Therefore the mathematical engine continues to produce divergence values before burn-in is complete.

The burn-in/readiness state affects the firmware's state tracking, but it does not currently suppress the divergence calculation.

---

## 19. Display

The ILI9341 display shows the current environment and divergence state.

Displayed fields include:

```text
TEMP
HUMIDITY
LUX
IAQ
NOISE
WORLD
DIVERGENCE
STATE
```

The gauge uses 20 segments:

```cpp
int segments = 20;
```

The number of active segments is:

```cpp
int active = divergence * segments;
```

Therefore the approximate number of active segments is:

```math
N_{\text{active}}
=
\lfloor20D\rfloor
```

subject to the integer conversion performed by the firmware.

The gauge color follows the world-line thresholds.

---

## 20. HTTP API

The ESP32 runs an HTTP server on port 80:

```cpp
WebServer server(80);
```

The data endpoint is:

```text
/data
```

and is registered with:

```cpp
server.on("/data", handleData);
```

The endpoint returns JSON containing:

```json
{
  "temperature": 0.0,
  "humidity": 0,
  "iaq": 0,
  "lux": 0,
  "sound": 0,
  "divergence": 0.000000
}
```

The values in the actual response come directly from the current firmware state.

A client therefore accesses the device as:

```text
http://ESP32_IP/data
```

---

## 21. Supabase Transmission

The firmware periodically sends data to the configured Supabase endpoint.

The send interval is:

```cpp
const unsigned long sendInterval = 60000;
```

which is:

```math
60\,000\text{ ms}=60\text{ seconds}
```

The payload contains:

```json
{
  "temperature": 0.0,
  "humidity": 0,
  "gas": 0,
  "light": 0,
  "sound": 0,
  "divergence": 0.000000
}
```

Notice that the firmware uses:

```text
gas
```

for the IAQ value and:

```text
light
```

for illuminance in the Supabase payload.

This differs from the HTTP `/data` endpoint, which uses:

```text
iaq
lux
```

for those two fields.

---

## 22. Network Configuration

The firmware contains placeholders:

```cpp
const char* ssid = "WIFI_ID";
const char* password = "WIFI_PASSWORD";

const char* supabaseUrl = "supabase_url";
const char* supabaseKey = "supabase_key";
```

These must be replaced before deployment.

The ESP32 connects using:

```cpp
WiFi.begin(ssid, password);
```

and prints its local IP address after connection:

```cpp
Serial.print("IP: ");
Serial.println(WiFi.localIP());
```

The EDM-App can then use that IP to access:

```text
http://ESP32_IP/data
```

---

## 23. Full Processing Algorithm

The main loop can be summarized as:

```text
1. Handle incoming HTTP requests.
2. Update BME688/BSEC.
3. Read temperature.
4. Read humidity.
5. Read IAQ.
6. Read BH1750 illuminance.
7. Read 200 microphone samples.
8. Calculate microphone RMS.
9. Convert RMS to the firmware sound level.
10. Normalize all five measurements.
11. Apply divergence weights.
12. Calculate the raw divergence score.
13. Apply the EMA.
14. Store the final divergence.
15. Update the TFT display.
16. Update the gauge.
17. Update the scanner animation.
18. Periodically save BSEC state.
19. Periodically send data to Supabase.
20. Wait approximately one second.
```

---

## 24. Mathematical Specification

For implementation and research purposes, the current model can be compactly defined as follows.

Define the clamp operator:

```math
C(x)=\min(1,\max(0,x))
```

Sensor normalizations:

```math
T_n=C\left(\frac{T-20}{15}\right)
```

```math
H_n=C\left(1-\frac{|H-50|}{50}\right)
```

```math
G_n=C\left(1-\frac{G}{300}\right)
```

```math
S_n=C\left(1-\frac{S}{100}\right)
```

```math
L_n=C\left(1-\frac{|L-300|}{700}\right)
```

Weighted raw score:

```math
R_t=
0.30T_n+
0.25G_n+
0.20H_n+
0.15S_n+
0.10L_n
```

Temporal filter:

```math
D_t=
0.20R_t+
0.80D_{t-1}
```

World line:

```math
W(D)=\text{ALPHA},\quad 0\le D<0.30
```

```math
W(D)=\text{BETA},\quad 0.30\le D<0.60
```

```math
W(D)=\text{GAMMA},\quad 0.60\le D<0.90
```

```math
W(D)=\text{STEINS},\quad 0.90\le D\le1
```

Global bound:

```math
\boxed{0\le D_t\le1}
```

---

## 25. Implementation Reference

The central divergence implementation is:

```cpp
float T = constrain((temp - 20.0) / 15.0, 0, 1);
float H = constrain(1.0 - abs(humidity - 50.0) / 50.0, 0, 1);
float G = constrain(1.0 - (iaq / 300.0), 0, 1);
float S = constrain(1.0 - (sound / 100.0), 0, 1);
float L = constrain(1.0 - abs(lux - 300.0) / 700.0, 0, 1);

float raw =
    0.30 * T +
    0.25 * G +
    0.20 * H +
    0.15 * S +
    0.10 * L;

smoothedDivergence =
    alpha * raw +
    (1 - alpha) * smoothedDivergence;

divergence = smoothedDivergence;
```

with:

```cpp
float alpha = 0.2;
```

This section should be treated as the executable reference for the mathematical specification above.

---

## 26. Model Versioning

The mathematical model should be versioned whenever any of the following changes:

- A normalization equation changes.
- A normalization range changes.
- A weighting coefficient changes.
- The EMA coefficient changes.
- World-line thresholds change.
- A sensor is added or removed.
- The sound conversion changes.
- The meaning of any sensor variable changes.

Changing any of these values changes the behavior of the EDM model.

For reproducibility, future firmware revisions should document the model version together with the formula and parameter set.

---

## 27. Current Parameter Set

| Parameter | Current value |
|---|---:|
| Temperature offset | 20 |
| Temperature scale | 15 |
| Humidity center | 50% |
| Humidity scale | 50 |
| IAQ scale | 300 |
| Sound scale | 100 |
| Light center | 300 lux |
| Light scale | 700 |
| Temperature weight | 0.30 |
| IAQ weight | 0.25 |
| Humidity weight | 0.20 |
| Sound weight | 0.15 |
| Light weight | 0.10 |
| EMA $\alpha$ | 0.20 |
| State save interval | 10 min |
| Supabase send interval | 60 s |
| Main loop delay | 1 s |
| Microphone samples | 200 |
| I2S sample rate | 44.1 kHz |

---

## 28. Limitations of the Current Model

The current model is an implementation-defined scoring system.

The firmware does not currently claim:

- medical validity,
- clinical validity,
- universal indoor-air-quality validity,
- calibrated sound-pressure-level measurement,
- a statistically trained divergence model,
- a validated comfort model.

The constants are parameters of the current EDM implementation.

In particular, the model should not be interpreted as a replacement for established environmental measurements or safety standards.

The purpose of the model is to produce a consistent, bounded, responsive scalar representation of the selected environmental inputs.

---

## 29. Repository Reference

The primary implementation is contained in:

```text
EDM.ino
```

The mobile application can consume the ESP32 JSON interface through:

```text
GET /data
```

The mathematical model is implemented on the ESP32 itself before the result is sent to the display, HTTP client, or Supabase.

The repository documentation should therefore treat the firmware equation as the source of truth for the hardware-generated divergence value.

---

## 30. Summary

The EDM divergence engine is a two-stage model.

First, the raw environmental measurements are normalized:

```math
(T,H,G,S,L)
\longrightarrow
(T_n,H_n,G_n,S_n,L_n)
```

Second, the normalized values are combined:

```math
R_t=
0.30T_n+
0.25G_n+
0.20H_n+
0.15S_n+
0.10L_n
```

and temporally filtered:

```math
\boxed{
D_t=
0.20R_t+
0.80D_{t-1}
}
```

The result is bounded:

```math
\boxed{0\le D_t\le1}
```

and classified into one of four project world lines:

```text
0.00 ────────── 0.30 ────────── 0.60 ────────── 0.90 ────────── 1.00
  │     ALPHA     │     BETA      │     GAMMA     │    STEINS     │
```

The current implementation is intentionally deterministic: the same sensor state and previous divergence state produce the same next divergence value.
