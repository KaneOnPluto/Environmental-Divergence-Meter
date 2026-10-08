# Environmental Divergence Meter — Mathematical Model

## 1. Overview

The Environmental Divergence Meter (EDM) produces a scalar value in the interval

\[
0 \le D_t \le 1
\]

from five environmental measurements:

1. Temperature
2. Relative humidity
3. Indoor air quality (IAQ)
4. Sound level
5. Illuminance

The implementation in the ESP32 firmware does not combine the raw sensor values directly. Each measurement is first transformed into a normalized score in \([0,1]\), after which the normalized scores are combined using fixed weights.

The resulting value is then passed through a first-order exponential smoothing filter.

The complete model is therefore:

\[
\boxed{
D_t
=
\alpha
\left(
0.30T_n
+
0.25G_n
+
0.20H_n
+
0.15S_n
+
0.10L_n
\right)
+
(1-\alpha)D_{t-1}
}
\]

with

\[
\alpha = 0.2
\]

where:

- \(T_n\) = normalized temperature score
- \(H_n\) = normalized humidity score
- \(G_n\) = normalized IAQ score
- \(S_n\) = normalized sound score
- \(L_n\) = normalized light score

The firmware applies the weighting in the order:

\[
\text{Temperature} = 30\%
\]

\[
\text{IAQ} = 25\%
\]

\[
\text{Humidity} = 20\%
\]

\[
\text{Sound} = 15\%
\]

\[
\text{Light} = 10\%
\]

The weights sum to one:

\[
0.30 + 0.25 + 0.20 + 0.15 + 0.10 = 1
\]

This guarantees that the weighted raw score remains in \([0,1]\), provided every normalized component is also constrained to \([0,1]\).

---

# 2. Sensor Inputs

The firmware obtains its five inputs from three sensor devices.

| Variable | Quantity | Hardware / source |
|---|---|---|
| \(T\) | Temperature in °C | BME688 through BSEC |
| \(H\) | Relative humidity in % | BME688 through BSEC |
| \(G\) | IAQ index | BME688 through BSEC |
| \(L\) | Illuminance in lux | BH1750 |
| \(S\) | Sound level, firmware-scaled | INMP441 |

## 2.1 BME688

The BME688 values are obtained through the BSEC library.

The firmware subscribes to:

```cpp
BSEC_OUTPUT_IAQ
BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_TEMPERATURE
BSEC_OUTPUT_SENSOR_HEAT_COMPENSATED_HUMIDITY
```

Therefore the mathematical model uses:

- heat-compensated temperature,
- heat-compensated relative humidity,
- BSEC IAQ.

The IAQ value is not raw gas resistance. It is the IAQ output produced by BSEC.

## 2.2 BH1750

The BH1750 supplies illuminance in lux.

The firmware stores this measurement as:

```cpp
lux
```

and converts it into the normalized light score \(L_n\).

## 2.3 INMP441

The INMP441 is read through I2S.

The firmware:

1. Collects 200 samples.
2. Shifts each sample by 14 bits.
3. Squares the samples.
4. Computes the root mean square (RMS).
5. Divides the RMS value by 50.
6. Constrains the resulting value to the interval \([0,100]\).

Mathematically, for samples \(x_1,\ldots,x_N\), with \(N=200\):

\[
x_i' = x_i \gg 14
\]

\[
RMS =
\sqrt{
\frac{1}{N}
\sum_{i=1}^{N}(x_i')^2
}
\]

and the firmware-level sound quantity is approximately:

\[
S_{\text{raw}}
=
\operatorname{clamp}
\left(
\frac{RMS}{50},
0,
100
\right)
\]

This value is then used by the divergence model.

> The firmware's sound value is a device-specific level produced by the current signal-processing implementation. It is not documented in the code as a calibrated physical dB measurement.

---

# 3. Normalization

The raw measurements have different physical units and scales. They cannot be added meaningfully without normalization.

Every sensor score is therefore mapped to:

\[
[0,1]
\]

using the firmware's `constrain()` operation.

Define:

\[
\operatorname{clamp}(x,0,1)
=
\begin{cases}
0, & x<0\\
x, & 0\le x\le1\\
1, & x>1
\end{cases}
\]

The five normalization functions are described below.

---

# 4. Temperature Normalization

Let \(T\) be the temperature in degrees Celsius.

The firmware implements:

```cpp
float T = constrain((temp - 20.0) / 15.0, 0, 1);
```

Therefore:

\[
\boxed{
T_n =
\operatorname{clamp}
\left(
\frac{T-20}{15},
0,
1
\right)
}
\]

Equivalently:

\[
T_n =
\begin{cases}
0, & T\le20\\[4pt]
\dfrac{T-20}{15}, & 20<T<35\\[8pt]
1, & T\ge35
\end{cases}
\]

The slope in the unclamped region is:

\[
\frac{\partial T_n}{\partial T}
=
\frac{1}{15}
\]

Since temperature has a final weight of \(0.30\), its direct contribution changes at:

\[
\frac{0.30}{15}
=
0.02
\]

raw divergence units per °C while \(20<T<35\).

### Important interpretation

This function is **monotonically increasing** from 20°C to 35°C.

It does not have a temperature optimum around a comfortable indoor range. Under the current firmware, temperatures at or above 35°C receive the maximum temperature score:

\[
T_n=1
\]

This is a property of the implemented mathematical model, not an assumption added by this documentation.

---

# 5. Humidity Normalization

Let \(H\) be relative humidity in percent.

The firmware implements:

```cpp
float H = constrain(1.0 - abs(humidity - 50.0) / 50.0, 0, 1);
```

Therefore:

\[
\boxed{
H_n =
\operatorname{clamp}
\left(
1-\frac{|H-50|}{50},
0,
1
\right)
}
\]

This is a triangular function centered at 50%.

Its piecewise form is:

\[
H_n =
\begin{cases}
1-\dfrac{50-H}{50}, & H<50\\[8pt]
1, & H=50\\[8pt]
1-\dfrac{H-50}{50}, & H>50
\end{cases}
\]

For physical humidity values between 0% and 100%, this simplifies to:

\[
H_n = 1-\frac{|H-50|}{50}
\]

with:

\[
H_n=1
\quad\text{at}\quad H=50\%
\]

and:

\[
H_n=0
\quad\text{at}\quad H=0\%\text{ or }100\%
\]

The contribution weight is 20%.

---

# 6. IAQ Normalization

Let \(G\) be the BSEC IAQ index.

The firmware implements:

```cpp
float G = constrain(1.0 - (iaq / 300.0), 0, 1);
```

Therefore:

\[
\boxed{
G_n =
\operatorname{clamp}
\left(
1-\frac{G}{300},
0,
1
\right)
}
\]

Piecewise:

\[
G_n =
\begin{cases}
1, & G\le0\\[4pt]
1-\dfrac{G}{300}, & 0<G<300\\[8pt]
0, & G\ge300
\end{cases}
\]

For the normal non-negative IAQ domain:

\[
0\le G\le300
\]

the score is linear.

The slope is:

\[
\frac{\partial G_n}{\partial G}
=
-\frac{1}{300}
\]

The IAQ term has the largest reduction coefficient among the environmental measurements except temperature's positive slope:

\[
\frac{0.25}{300}
=
0.0008333\ldots
\]

raw divergence units per IAQ unit.

The direction is physically intuitive within the implemented model:

- lower IAQ index → higher score,
- higher IAQ index → lower score.

---

# 7. Sound Normalization

Let \(S\) be the firmware's sound level.

The firmware implements:

```cpp
float S = constrain(1.0 - (sound / 100.0), 0, 1);
```

Therefore:

\[
\boxed{
S_n =
\operatorname{clamp}
\left(
1-\frac{S}{100},
0,
1
\right)
}
\]

Piecewise:

\[
S_n =
\begin{cases}
1, & S\le0\\[4pt]
1-\dfrac{S}{100}, & 0<S<100\\[8pt]
0, & S\ge100
\end{cases}
\]

For \(0\le S\le100\):

\[
\frac{\partial S_n}{\partial S}
=
-\frac{1}{100}
\]

The sound term contributes 15% of the raw score.

---

# 8. Light Normalization

Let \(L\) be illuminance in lux.

The firmware implements:

```cpp
float L = constrain(1.0 - abs(lux - 300.0) / 700.0, 0, 1);
```

Therefore:

\[
\boxed{
L_n =
\operatorname{clamp}
\left(
1-\frac{|L-300|}{700},
0,
1
\right)
}
\]

The function is centered at:

\[
L=300\text{ lux}
\]

and decreases as illuminance moves away from that point.

For \(L\ge0\), the function is:

\[
L_n =
\begin{cases}
1-\dfrac{300-L}{700}, & 0\le L<300\\[8pt]
1, & L=300\\[4pt]
1-\dfrac{L-300}{700}, & L>300
\end{cases}
\]

Within the unclamped regions, the absolute slope is:

\[
\left|\frac{\partial L_n}{\partial L}\right|
=
\frac{1}{700}
\]

The light term has the smallest model weight:

\[
0.10
\]

---

# 9. Weighted Raw Divergence

Once the five normalized values have been calculated, the firmware computes:

```cpp
float raw =
    0.30 * T +
    0.25 * G +
    0.20 * H +
    0.15 * S +
    0.10 * L;
```

where the variables now represent normalized scores.

Using explicit subscripts:

\[
\boxed{
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
}
\]

This is a weighted linear combination.

Because:

\[
0\le T_n,H_n,G_n,S_n,L_n\le1
\]

and:

\[
\sum_i w_i=1
\]

the raw score satisfies:

\[
\boxed{
0\le R_t\le1
}
\]

This is the first stage of the model.

---

# 10. Temporal Smoothing

The raw score is not sent directly to the display or network.

The firmware applies:

```cpp
float alpha = 0.2;
```

and then:

```cpp
smoothedDivergence =
    alpha * raw +
    (1 - alpha) * smoothedDivergence;

divergence = smoothedDivergence;
```

Thus:

\[
\boxed{
D_t
=
0.2R_t
+
0.8D_{t-1}
}
\]

where:

- \(R_t\) is the current raw score,
- \(D_t\) is the displayed/stored divergence,
- \(D_{t-1}\) is the previous smoothed divergence.

This is a first-order exponential moving average (EMA).

---

# 11. Expanded Complete Formula

Substituting all normalization functions into the raw score gives:

\[
R_t
=
0.30
\operatorname{clamp}
\left(
\frac{T-20}{15},
0,
1
\right)
\]

\[
+
0.25
\operatorname{clamp}
\left(
1-\frac{G}{300},
0,
1
\right)
\]

\[
+
0.20
\operatorname{clamp}
\left(
1-\frac{|H-50|}{50},
0,
1
\right)
\]

\[
+
0.15
\operatorname{clamp}
\left(
1-\frac{S}{100},
0,
1
\right)
\]

\[
+
0.10
\operatorname{clamp}
\left(
1-\frac{|L-300|}{700},
0,
1
\right)
\]

The final divergence is:

\[
\boxed{
D_t
=
0.2R_t+0.8D_{t-1}
}
\]

or, in one expression:

\[
\boxed{
\begin{aligned}
D_t
={}&
0.2
\Bigg[
0.30
\operatorname{clamp}
\left(
\frac{T-20}{15},0,1
\right)
\\
&+
0.25
\operatorname{clamp}
\left(
1-\frac{G}{300},0,1
\right)
\\
&+
0.20
\operatorname{clamp}
\left(
1-\frac{|H-50|}{50},0,1
\right)
\\
&+
0.15
\operatorname{clamp}
\left(
1-\frac{S}{100},0,1
\right)
\\
&+
0.10
\operatorname{clamp}
\left(
1-\frac{|L-300|}{700},0,1
\right)
\Bigg]
\\
&+
0.8D_{t-1}
\end{aligned}
}
\]

This equation is the mathematical representation of the current firmware implementation.

---

# 12. Worked Example

Consider the following sensor state:

| Measurement | Value |
|---|---:|
| Temperature | 25°C |
| Humidity | 50% |
| IAQ | 50 |
| Sound | 30 |
| Light | 300 lux |

## 12.1 Normalize temperature

\[
T_n=\frac{25-20}{15}
=\frac{5}{15}
=0.3333
\]

## 12.2 Normalize humidity

\[
H_n
=
1-\frac{|50-50|}{50}
=1
\]

## 12.3 Normalize IAQ

\[
G_n
=
1-\frac{50}{300}
=
0.8333
\]

## 12.4 Normalize sound

\[
S_n
=
1-\frac{30}{100}
=
0.70
\]

## 12.5 Normalize light

\[
L_n
=
1-\frac{|300-300|}{700}
=
1
\]

## 12.6 Weighted raw score

\[
\begin{aligned}
R
&=
0.30(0.3333)
+
0.25(0.8333)
+
0.20(1)
+
0.15(0.70)
+
0.10(1)
\\
&\approx
0.1000
+
0.2083
+
0.2000
+
0.1050
+
0.1000
\\
&=
0.7133
\end{aligned}
\]

Therefore the raw divergence score is approximately:

\[
\boxed{R=0.7133}
\]

---

# 13. Effect of the EMA

Assume the previous smoothed value was:

\[
D_{t-1}=0
\]

Then:

\[
D_t
=
0.2(0.7133)+0.8(0)
\]

\[
\boxed{
D_t\approx0.1427
}
\]

The raw score is therefore not displayed immediately.

After repeated identical measurements:

\[
D_t=0.7133(1-0.8^t)
\]

when starting from \(D_0=0\).

This shows that the displayed value approaches the raw value asymptotically rather than jumping directly to it.

---

# 14. EMA Response Characteristics

For a constant raw value \(R\), the error relative to the final value is:

\[
|R-D_t|
=
|R-D_0|(1-\alpha)^t
\]

With:

\[
\alpha=0.2
\]

the remaining fraction is:

\[
0.8^t
\]

The approximate half-life is obtained from:

\[
0.8^t=0.5
\]

so:

\[
t=
\frac{\ln(0.5)}{\ln(0.8)}
\approx3.11
\]

Thus the EMA reaches 50% of a step change after approximately:

\[
\boxed{3.1\text{ update cycles}}
\]

The 95% settling point satisfies:

\[
0.8^t=0.05
\]

giving:

\[
t=
\frac{\ln(0.05)}{\ln(0.8)}
\approx13.43
\]

So approximately 13–14 update cycles are required to reach 95% of a constant new value.

The main loop contains a one-second delay:

```cpp
delay(1000);
```

so the practical response time is on the order of seconds.

---

# 15. Contribution Decomposition

The raw score can be treated as five weighted contributions:

\[
R=R_T+R_G+R_H+R_S+R_L
\]

where:

\[
R_T=0.30T_n
\]

\[
R_G=0.25G_n
\]

\[
R_H=0.20H_n
\]

\[
R_S=0.15S_n
\]

\[
R_L=0.10L_n
\]

The maximum possible contribution of each component is therefore:

| Component | Weight | Maximum contribution |
|---|---:|---:|
| Temperature | 0.30 | 0.30 |
| IAQ | 0.25 | 0.25 |
| Humidity | 0.20 | 0.20 |
| Sound | 0.15 | 0.15 |
| Light | 0.10 | 0.10 |
| **Total** | **1.00** | **1.00** |

This provides a direct interpretation of the weighting system.

A one-unit improvement in a normalized component changes the raw score by exactly its corresponding weight.

---

# 16. Local Sensitivity

Within the unclamped regions, the raw model is linear.

For temperature:

\[
\frac{\partial R}{\partial T}
=
0.30\cdot\frac1{15}
=
0.02
\]

For humidity on either side of the 50% center:

\[
\left|
\frac{\partial R}{\partial H}
\right|
=
0.20\cdot\frac1{50}
=
0.004
\]

For IAQ:

\[
\frac{\partial R}{\partial G}
=
-0.25\cdot\frac1{300}
\approx
-0.0008333
\]

For sound:

\[
\frac{\partial R}{\partial S}
=
-0.15\cdot\frac1{100}
=
-0.0015
\]

For light on either side of 300 lux:

\[
\left|
\frac{\partial R}{\partial L}
\right|
=
0.10\cdot\frac1{700}
\approx
0.00014286
\]

These derivatives describe the local effect on the **raw** score. The displayed divergence additionally depends on the EMA state.

---

# 17. World-Line Classification

The firmware converts the final smoothed divergence into a world-line label.

The implementation is:

```cpp
if (d < 0.30) return "ALPHA";
if (d < 0.60) return "BETA";
if (d < 0.90) return "GAMMA";
return "STEINS";
```

Therefore:

\[
\boxed{
W(D)=
\begin{cases}
\text{ALPHA}, & 0\le D<0.30\\
\text{BETA}, & 0.30\le D<0.60\\
\text{GAMMA}, & 0.60\le D<0.90\\
\text{STEINS}, & 0.90\le D\le1
\end{cases}
}
\]

The associated display colors are:

| Range | World line |
|---|---|
| \(0\le D<0.30\) | ALPHA |
| \(0.30\le D<0.60\) | BETA |
| \(0.60\le D<0.90\) | GAMMA |
| \(0.90\le D\le1\) | STEINS |

The world-line classification does not modify the numerical divergence. It is only a categorical interpretation of the final value.

---

# 18. Divergence vs. Environmental Quality

Although the firmware calls the final scalar `divergence`, the implemented mathematics behaves as a **weighted environmental quality score**:

\[
\text{higher score} \Rightarrow \text{higher model output}
\]

and:

\[
\text{lower score} \Rightarrow \text{lower model output}
\]

This is especially evident for IAQ and sound, where increasing the measured quantity decreases the score.

The term "divergence" is therefore a project-level interpretation rather than a mathematical statement that the quantity represents a geometric distance from an equilibrium state.

No additional transformation is applied after the EMA.

---

# 19. Bounds and Invariants

Because each normalized score is clamped:

\[
0\le X_n\le1
\]

for every component \(X\).

The weighted sum therefore satisfies:

\[
0\le R_t\le1
\]

The EMA is a convex combination of the current raw score and the previous divergence:

\[
D_t=0.2R_t+0.8D_{t-1}
\]

If:

\[
0\le D_{t-1}\le1
\]

then:

\[
0\le D_t\le1
\]

Therefore, starting from the firmware's initial state:

\[
D_0=0
\]

the divergence remains bounded:

\[
\boxed{
0\le D_t\le1
}
\]

for all subsequent updates.

---

# 20. Initialization Behavior

The firmware declares:

```cpp
float divergence = 0;
float smoothedDivergence = 0;
```

Therefore:

\[
D_0=0
\]

before the first valid update.

This means the first displayed values are biased toward zero until the EMA responds to the incoming measurements.

This is expected behavior for a recursively initialized EMA.

---

# 21. Sensor Accuracy and Burn-In

The firmware keeps track of BSEC accuracy and a 24-hour burn-in interval:

```cpp
const unsigned long BURN_IN_TIME =
    24UL * 60UL * 60UL * 1000UL;
```

and:

```cpp
bool sensorReady = (iaqSensor.iaqAccuracy >= 2);
```

However, the divergence equations are **not gated by `isBurnInComplete`**.

In other words, the model continues to calculate:

\[
R_t
\]

and:

\[
D_t
\]

even when the BSEC sensor has not yet reached the desired accuracy state.

The burn-in state therefore describes sensor readiness but does not mathematically disable the divergence engine.

---

# 22. Update Frequency

The main loop performs:

1. BSEC sensor update
2. illuminance measurement
3. sound measurement
4. normalization
5. weighted score calculation
6. EMA update
7. display update
8. network/state operations when their timers expire

and then executes:

```cpp
delay(1000);
```

Therefore the divergence state is updated approximately once per second under normal execution.

The exact wall-clock interval can be slightly greater than one second because sensor reads, display operations, network handling, and other code execute before the delay.

---

# 23. Data Flow

The complete mathematical/data pipeline is:

```text
BME688
 ├── Temperature ───────┐
 ├── Humidity ──────────┤
 └── BSEC IAQ ──────────┤
                        │
BH1750 ── Illuminance ───┤
                        │
INMP441 ── Sound ────────┤
                        ▼
                  Normalization
                        │
                        ▼
              Weighted linear sum
                        │
                        ▼
                    Raw score R
                        │
                        ▼
                 EMA, α = 0.2
                        │
                        ▼
                Divergence D ∈ [0,1]
                   /            \
                  /              \
                 ▼                ▼
          World-line         Supabase / HTTP
          classification         JSON
```

---

# 24. Compact Mathematical Specification

For implementation purposes, the entire current model can be specified as follows.

Define:

\[
C(x)=\min(1,\max(0,x))
\]

Then:

\[
T_n=C\left(\frac{T-20}{15}\right)
\]

\[
H_n=C\left(1-\frac{|H-50|}{50}\right)
\]

\[
G_n=C\left(1-\frac{G}{300}\right)
\]

\[
S_n=C\left(1-\frac{S}{100}\right)
\]

\[
L_n=C\left(1-\frac{|L-300|}{700}\right)
\]

Raw score:

\[
\boxed{
R_t=
0.30T_n+
0.25G_n+
0.20H_n+
0.15S_n+
0.10L_n
}
\]

Final score:

\[
\boxed{
D_t=0.20R_t+0.80D_{t-1}
}
\]

World line:

\[
\boxed{
W(D)=
\begin{cases}
\text{ALPHA}, & D<0.30\\
\text{BETA}, & 0.30\le D<0.60\\
\text{GAMMA}, & 0.60\le D<0.90\\
\text{STEINS}, & D\ge0.90
\end{cases}
}
\]

with:

\[
\boxed{0\le D_t\le1}
\]

---

# 25. Implementation Reference

The normalization and weighting stage is implemented in the ESP32 loop as:

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

This code is the source implementation represented by the equations in this document.

---

# 26. Model Characteristics

The current model has the following mathematical properties:

- It is bounded to \([0,1]\).
- It is a weighted linear combination after nonlinear normalization.
- Humidity and light use symmetric distance-from-target functions.
- IAQ and sound are monotonically decreasing scores.
- Temperature is monotonically increasing between 20°C and 35°C and saturates above 35°C.
- The final value is exponentially smoothed.
- The maximum raw contribution comes from temperature at 30%.
- The second-largest contribution is IAQ at 25%.
- The final value changes more slowly than the raw value because of the EMA.
- World-line labels are thresholds applied after smoothing.
- Sensor burn-in/readiness does not currently gate the mathematical calculation.

---

# 27. Scope of This Document

This document describes the **implemented firmware model**.

It does not claim that the normalization constants are medically validated, scientifically optimal, or universally applicable to indoor environmental quality. The constants:

\[
20,\ 35,\ 50,\ 300,\ 700,\ 100
\]

and the weights:

\[
0.30,\ 0.25,\ 0.20,\ 0.15,\ 0.10
\]

are the parameters currently encoded in the EDM firmware.

Any future scientific calibration, statistical validation, sensor calibration, or redesign of the normalization curves should be documented as a new model version rather than silently changing the mathematical definition of the existing one.
