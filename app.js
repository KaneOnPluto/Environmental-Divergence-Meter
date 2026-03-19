import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  TextInput,
  Image,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

/* ===================== CONSTANTS ===================== */

const MAP_SOURCE = {
  uri: 'https://task-stalker.vercel.app/asset/New_WM.jpg',
};

const TABS = {
  LIVE: 'live',
  SIMULATION: 'simulation',
  DOCS: 'docs',
};

/* ===================== DIVERGENCE ENGINE ===================== */

// Normalization functions based on the divergence model
const normalizeTemperature = (T) => {
  if (T >= 22.2 && T <= 25.6) return 1.0;
  if (T >= 20.0 && T < 22.2) return 1.0 - ((22.2 - T) / 2.2) * 0.3;
  if (T > 25.6 && T <= 28.0) return 1.0 - ((T - 25.6) / 2.4) * 0.3;
  if (T >= 18.0 && T < 20.0) return 0.7 - ((20.0 - T) / 2.0) * 0.4;
  if (T > 28.0 && T <= 31.0) return 0.7 - ((T - 28.0) / 3.0) * 0.4;
  if (T >= 16.0 && T < 18.0) return 0.3 - ((18.0 - T) / 2.0) * 0.2;
  if (T > 31.0 && T <= 35.0) return 0.3 - ((T - 31.0) / 4.0) * 0.2;
  return 0.0;
};

const normalizeHumidity = (H) => {
  if (H >= 40 && H <= 50) return 1.0;
  if (H >= 30 && H < 40) return 1.0 - ((40 - H) / 10) * 0.2;
  if (H > 50 && H <= 60) return 1.0 - ((H - 50) / 10) * 0.2;
  if (H >= 20 && H < 30) return 0.8 - ((30 - H) / 10) * 0.4;
  if (H > 60 && H <= 70) return 0.8 - ((H - 60) / 10) * 0.4;
  if (H >= 10 && H < 20) return 0.4 - ((20 - H) / 10) * 0.3;
  if (H > 70 && H <= 80) return 0.4 - ((H - 70) / 10) * 0.3;
  return 0.0;
};

const normalizeIAQ = (G) => {
  if (G >= 0 && G <= 50) return 1.0;
  if (G > 50 && G <= 100) return 1.0 - ((G - 50) / 50) * 0.2;
  if (G > 100 && G <= 150) return 0.8 - ((G - 100) / 50) * 0.2;
  if (G > 150 && G <= 200) return 0.6 - ((G - 150) / 50) * 0.3;
  if (G > 200 && G <= 300) return 0.3 - ((G - 200) / 100) * 0.2;
  return 0.0;
};

const normalizeLux = (L) => {
  if (L >= 300 && L <= 500) return 1.0;
  if (L >= 100 && L < 300) return 1.0 - ((300 - L) / 200) * 0.2;
  if (L >= 50 && L < 100) return 0.8 - ((100 - L) / 50) * 0.3;
  if (L >= 10 && L < 50) return 0.5 - ((50 - L) / 40) * 0.3;
  if (L < 10) return 0.0;
  if (L > 10000) return 0.1;
  return 1.0; // Default for values between 500 and 10000
};

const normalizeSound = (S) => {
  if (S <= 30) return 1.0;
  if (S > 30 && S <= 40) return 1.0 - ((S - 30) / 10) * 0.1;
  if (S > 40 && S <= 50) return 0.9 - ((S - 40) / 10) * 0.2;
  if (S > 50 && S <= 65) return 0.7 - ((S - 50) / 15) * 0.4;
  if (S > 65 && S <= 85) return 0.3 - ((S - 65) / 20) * 0.2;
  return 0.0;
};

// Calculate divergence value
const calculateDivergence = (temp, humidity, iaq, lux, sound) => {
  const fT = normalizeTemperature(parseFloat(temp) || 0);
  const fH = normalizeHumidity(parseFloat(humidity) || 0);
  const fG = normalizeIAQ(parseFloat(iaq) || 0);
  const fL = normalizeLux(parseFloat(lux) || 0);
  const fS = normalizeSound(parseFloat(sound) || 0);

  return (0.30 * fT) + (0.20 * fH) + (0.25 * fG) + (0.10 * fL) + (0.15 * fS);
};

// World line mapping based on divergence value
const getWorldLine = (d) => {
  if (d === null || isNaN(d)) return 'UNDEFINED';
  if (d < 0.2) return 'ALPHA';
  if (d < 0.6) return 'BETA';
  if (d < 0.8) return 'GAMMA';
  if (d >= 0.9) return 'STEINS';
  return 'TRANSITION'; // 0.800 – 0.899
};

// Get divergence category
const getDivergenceCategory = (d) => {
  if (d >= 0.90) return { label: 'PERFECT', color: '#00ff88', emoji: '🟢' };
  if (d >= 0.80) return { label: 'EXCELLENT', color: '#88ff88', emoji: '🟢' };
  if (d >= 0.60) return { label: 'ACCEPTABLE', color: '#ffcc66', emoji: '🟡' };
  if (d >= 0.20) return { label: 'POOR', color: '#ff9944', emoji: '🟠' };
  return { label: 'SEVERE', color: '#ff4444', emoji: '🔴' };
};

// Get world line color
const getWorldLineColor = (worldLine) => {
  switch (worldLine) {
    case 'ALPHA': return '#ff8888';
    case 'BETA': return '#ffaa66';
    case 'GAMMA': return '#88cc88';
    case 'STEINS': return '#aaccff';
    case 'TRANSITION': return '#cccccc';
    default: return '#888888';
  }
};

/* ===================== MAIN APP ===================== */

export default function App() {
  const [activeTab, setActiveTab] = useState(TABS.LIVE);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerText}>Environmental Divergence Meter</Text>
        <Text style={styles.subHeader}>DIVERGENCE MODEL v 1.0</Text>
      </View>

      {/* Tab Content */}
      <ScrollView style={styles.content}>
        <TerminalPanel>
          {activeTab === TABS.LIVE && <LiveDataMode />}
          {activeTab === TABS.SIMULATION && <SimulationMode />}
          {activeTab === TABS.DOCS && <DocumentationMode />}
        </TerminalPanel>
      </ScrollView>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TabButton
          label="LIVE DATA"
          active={activeTab === TABS.LIVE}
          onPress={() => setActiveTab(TABS.LIVE)}
        />
        <TabButton
          label="SIMULATION"
          active={activeTab === TABS.SIMULATION}
          onPress={() => setActiveTab(TABS.SIMULATION)}
        />
        <TabButton
          label="DOCS"
          active={activeTab === TABS.DOCS}
          onPress={() => setActiveTab(TABS.DOCS)}
        />
      </View>
    </View>
  );
}

/* ===================== LIVE DATA MODE ===================== */

function LiveDataMode() {
  const [liveData, setLiveData] = useState({
    temperature: null,
    humidity: null,
    iaq: null,
    lux: null,
    sound: null,
    divergence: null,
  });
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // World‑line mapping based on divergence value
  const getWorldLineForLive = (d) => {
    if (d === null) return 'WAITING...';
    if (d < 0.2) return 'ALPHA';
    if (d < 0.6) return 'BETA';
    if (d < 0.8) return 'GAMMA';
    if (d >= 0.9) return 'STEINS';
    return 'TRANSITION';
  };

  // Simulate ESP32 connection and data fetch
  const fetchLiveData = async () => {
    setRefreshing(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Mock data - replace with actual ESP32 endpoint
    const mockData = {
      temperature: 30,
      humidity: 75,
      iaq: 180,
      lux: 50,
      sound: 65,
      divergence: 0.420000,
    };

    setLiveData(mockData);
    setConnected(true);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchLiveData();
    const interval = setInterval(fetchLiveData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View>
      <Line text="LIVE DATA MODE - ESP32 STREAM" />
      <Spacer />

      {/* Connection Status */}
      <Row
        icon={<ChipIcon />}
        label="STATUS"
        value={connected ? 'ESP32 CONNECTED' : 'DISCONNECTED'}
        color={connected ? '#00ff88' : '#ff4444'}
      />
      <Spacer />

      {/* Sensor Readings */}
      <Line text="SENSOR READINGS" />
      <Spacer />

      <Row
        icon={<TempIcon />}
        label="TEMPERATURE"
        value={
          liveData.temperature !== null
            ? `${liveData.temperature}°C`
            : 'WAITING...'
        }
      />
      <Row
        icon={<HumidityIcon />}
        label="HUMIDITY"
        value={
          liveData.humidity !== null ? `${liveData.humidity}%` : 'WAITING...'
        }
      />
      <Row
        icon={<AqiIcon />}
        label="IAQ INDEX"
        value={liveData.iaq !== null ? `${liveData.iaq}` : 'WAITING...'}
      />
      <Row
        icon={<LightIcon />}
        label="LUMINOSITY"
        value={liveData.lux !== null ? `${liveData.lux} LUX` : 'WAITING...'}
      />
      <Row
        icon={<SoundIcon />}
        label="SOUND LEVEL"
        value={liveData.sound !== null ? `${liveData.sound} dB` : 'WAITING...'}
      />
      <Row
        icon={<DivergenceIcon />}
        label="DIVERGENCE"
        value={
          liveData.divergence !== null
            ? liveData.divergence.toFixed(6)
            : 'WAITING...'
        }
        color={
          liveData.divergence !== null
            ? liveData.divergence < 0.2
              ? '#ff8888'
              : liveData.divergence < 0.6
              ? '#ffaa66'
              : liveData.divergence < 0.8
              ? '#88cc88'
              : liveData.divergence >= 0.9
              ? '#aaccff'
              : '#cccccc'
            : '#888888'
        }
      />

      {/* WORLD LINE */}
      <Row
        icon={<Text style={{ fontSize: 16, color: '#fff' }}>🌐</Text>}
        label="WORLD LINE"
        value={getWorldLineForLive(liveData.divergence)}
        color={
          liveData.divergence !== null
            ? liveData.divergence < 0.2
              ? '#ff8888'
              : liveData.divergence < 0.6
              ? '#ffaa66'
              : liveData.divergence < 0.8
              ? '#88cc88'
              : liveData.divergence >= 0.9
              ? '#aaccff'
              : '#cccccc'
            : '#888888'
        }
      />

      <Spacer />
      <TouchableOpacity onPress={fetchLiveData} disabled={refreshing}>
        <Text style={styles.command}>
          {refreshing ? '[ REFRESHING... ]' : '[ REFRESH DATA ]'}
        </Text>
      </TouchableOpacity>

      <Spacer />
      <Line text={`LAST UPDATE: ${new Date().toLocaleTimeString()}`} />
    </View>
  );
}

/* ===================== SIMULATION MODE ===================== */

function SimulationMode() {
  // Manual input state
  const [manualData, setManualData] = useState({
    temperature: '23.5',
    humidity: '45',
    iaq: '35',
    lux: '400',
    sound: '35',
  });

  // API data state (for simulation with real data)
  const [city, setCity] = useState('NEW YORK');
  const [coords, setCoords] = useState({ lat: 40.7128, lon: -74.006 });
  const [apiData, setApiData] = useState({
    temperature: null,
    humidity: null,
    iaq: null,
    lux: null,
    sound: null,
  });
  const [loading, setLoading] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Mode toggle
  const [inputMode, setInputMode] = useState('manual'); // "manual" or "api"

  // ---------- BUILDING QUALITY LOOKUP (by country code) ----------
  const BUILDING_QUALITY = {
    // Developed countries – best infrastructure
    US: 1.0, CA: 1.0, GB: 1.0, DE: 1.0, FR: 1.0, JP: 1.0, KR: 1.0, AU: 1.0,
    DK: 1.0, SE: 1.0, NO: 1.0, FI: 1.0, NL: 1.0, CH: 1.0, AT: 1.0, BE: 1.0,
    IT: 0.9, ES: 0.9, PT: 0.9, SG: 1.0, NZ: 1.0,
    // Emerging economies – moderate
    CN: 0.6, BR: 0.5, MX: 0.5, ZA: 0.5, TR: 0.5, TH: 0.4, VN: 0.4,
    // South Asia / highly polluted – poor
    IN: 0.3, PK: 0.3, BD: 0.2, NP: 0.3, LK: 0.4,
    // Default for unknown countries
    DEFAULT: 0.5
  };

  // Calculate divergence for current data
  const currentData = inputMode === 'manual' ? manualData : apiData;
  const divergence = calculateDivergence(
    currentData.temperature,
    currentData.humidity,
    currentData.iaq,
    currentData.lux,
    currentData.sound
  );
  const worldLine = getWorldLine(divergence);
  const category = getDivergenceCategory(divergence);

  // ---------- FETCH CITY DATA – CORRECTED ----------
  // Fetch when API mode is activated or city changes
useEffect(() => {
  const fetchCityData = async (cityName) => {
    try {
      setLoading(true);

      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${cityName}`
      );
      const geoData = await geoRes.json();
      if (!geoData.results) {
        setLoading(false);
        return;
      }

      const { latitude, longitude, name, country_code } = geoData.results[0];
      const countryCode = country_code.toUpperCase();
      const buildingQuality = BUILDING_QUALITY[countryCode] ?? BUILDING_QUALITY.DEFAULT;

      setCoords({ lat: latitude, lon: longitude });
      setCity(name.toUpperCase());

      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=relativehumidity_2m`
      );
      const weatherData = await weatherRes.json();

      const aqiRes = await fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=us_aqi,pm10,pm2_5`
      );
      const aqiData = await aqiRes.json();

      const currentHour = new Date().getHours();

      // ----- IAQ -----
      const outdoorAQI = aqiData.current?.us_aqi || 50;
      const infiltrationFactor = 1.0 - (buildingQuality * 0.6);
      let baseIAQ = outdoorAQI * infiltrationFactor * 1.5 + 20 + Math.random() * 30;
      const indoorIAQ = Math.min(500, Math.max(0, Math.round(baseIAQ)));

      // ----- TEMPERATURE -----
      const outdoorTemp = weatherData.current_weather.temperature;
      const acProbability = buildingQuality * 0.9 + 0.1;
      const hasAC = Math.random() < acProbability;

      let indoorTemp;
      if (hasAC) {
        indoorTemp = 22 + Math.random() * 3;
      } else {
        indoorTemp = Math.max(18, outdoorTemp - (2 + Math.random() * 3));
      }

      // ----- HUMIDITY -----
      const outdoorHumidity = weatherData.hourly.relativehumidity_2m[currentHour];
      let indoorHumidity;
      if (hasAC) {
        indoorHumidity = Math.min(60, outdoorHumidity * 0.6 + 10 + Math.random() * 10);
      } else {
        indoorHumidity = Math.min(85, outdoorHumidity * 0.9 + 5 + Math.random() * 10);
      }
      indoorHumidity = Math.max(20, Math.min(80, Math.round(indoorHumidity)));

      // ----- LIGHT -----
      const isDaytime = currentHour >= 6 && currentHour <= 18;
      const weatherCode = weatherData.current_weather.weathercode;
      let indoorLux;
      if (isDaytime) {
        if (weatherCode === 0) indoorLux = 350 + Math.random() * 200;
        else if (weatherCode < 50) indoorLux = 250 + Math.random() * 150;
        else indoorLux = 200 + Math.random() * 150;
      } else {
        indoorLux = 150 + Math.random() * 150;
      }

      // ----- SOUND -----
      const noiseBase = buildingQuality < 0.5 ? 45 : 30;
      const trafficNoise = 5 + Math.random() * 15;
      let indoorSound = noiseBase + trafficNoise * (1 - buildingQuality * 0.3);
      if (Math.abs(latitude) < 30) indoorSound += 5;
      indoorSound = Math.round(Math.min(75, Math.max(25, indoorSound)));

      setApiData({
        temperature: Math.round(indoorTemp * 10) / 10,
        humidity: indoorHumidity,
        iaq: indoorIAQ,
        lux: Math.round(indoorLux),
        sound: indoorSound,
      });

      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  if (inputMode === 'api') {
    fetchCityData(city);
  }
}, [city, inputMode]);

  // ---------- SEARCH FUNCTION ----------
  const searchCity = async () => {
    if (!searchQuery) return;
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${searchQuery}`
    );
    const data = await res.json();
    setSearchResults(data.results || []);
  };

  // ---------- RENDER (unchanged from original, except removed isWellDeveloped) ----------
  return (
    <View>
      <Line text="SIMULATION MODE - TEST ENVIRONMENT" />
      <Spacer />

      {/* Mode Toggle */}
      <View style={styles.modeToggle}>
        <TouchableOpacity
          onPress={() => setInputMode('manual')}
          style={[
            styles.modeButton,
            inputMode === 'manual' && styles.modeButtonActive,
          ]}>
          <Text
            style={[
              styles.modeButtonText,
              inputMode === 'manual' && styles.modeButtonTextActive,
            ]}>
            MANUAL INPUT
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setInputMode('api')}
          style={[
            styles.modeButton,
            inputMode === 'api' && styles.modeButtonActive,
          ]}>
          <Text
            style={[
              styles.modeButtonText,
              inputMode === 'api' && styles.modeButtonTextActive,
            ]}>
            API SIMULATION
          </Text>
        </TouchableOpacity>
      </View>

      <Spacer />

      {/* Manual Input Mode */}
      {inputMode === 'manual' && (
        <View>
          <Line text="MANUAL SENSOR INPUT" />
          <Spacer />

          <InputRow
            label="TEMPERATURE (°C)"
            value={manualData.temperature}
            onChangeText={(val) =>
              setManualData({ ...manualData, temperature: val })
            }
            placeholder="23.5"
          />
          <InputRow
            label="HUMIDITY (%)"
            value={manualData.humidity}
            onChangeText={(val) =>
              setManualData({ ...manualData, humidity: val })
            }
            placeholder="45"
          />
          <InputRow
            label="IAQ INDEX"
            value={manualData.iaq}
            onChangeText={(val) => setManualData({ ...manualData, iaq: val })}
            placeholder="35"
          />
          <InputRow
            label="LUMINOSITY (LUX)"
            value={manualData.lux}
            onChangeText={(val) => setManualData({ ...manualData, lux: val })}
            placeholder="400"
          />
          <InputRow
            label="SOUND (dB)"
            value={manualData.sound}
            onChangeText={(val) =>
              setManualData({ ...manualData, sound: val })
            }
            placeholder="35"
          />
        </View>
      )}

      {/* API Mode */}
      {inputMode === 'api' && (
        <View>
          <Line text="API DATA SOURCE + SIMULATION" />
          <Spacer />

          {/* City Search */}
          <Text style={styles.text}>{"> SEARCH LOCATION"}</Text>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="TYPE CITY NAME"
            placeholderTextColor="#004422"
            style={styles.input}
          />

          <TouchableOpacity onPress={searchCity}>
            <Text style={styles.command}>[ SEARCH ]</Text>
          </TouchableOpacity>

          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
              {searchResults.map((item, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => {
                    setCity(item.name.toUpperCase());
                    setSearchQuery('');
                    setSearchResults([]);
                  }}>
                  <Text style={styles.text}>
                    {'   '}→ {item.name.toUpperCase()}, {item.country}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Spacer />
          <Line text={`LOCATION: ${city}`} />
          <Line text="SIMULATING INDOOR CONDITIONS FROM OUTDOOR DATA" />
          <Spacer />

          {/* World Map */}
          <Line text="WORLD MAP" />
          <WorldMap coords={coords} />

          <Spacer />
          <Line text="SIMULATED INDOOR ENVIRONMENT" />
          <Spacer />

          {loading ? (
            <Text style={styles.text}>   LOADING DATA...</Text>
          ) : (
            <>
              <Row
                icon={<TempIcon />}
                label="TEMPERATURE"
                value={
                  apiData.temperature !== null
                    ? `${apiData.temperature}°C`
                    : 'N/A'
                }
              />
              <Row
                icon={<HumidityIcon />}
                label="HUMIDITY"
                value={
                  apiData.humidity !== null
                    ? `${apiData.humidity}%`
                    : 'N/A'
                }
              />
              <Row
                icon={<AqiIcon />}
                label="IAQ INDEX"
                value={apiData.iaq !== null ? `${apiData.iaq}` : 'N/A'}
              />
              <Row
                icon={<LightIcon />}
                label="LUMINOSITY"
                value={apiData.lux !== null ? `${apiData.lux} LUX` : 'N/A'}
              />
              <Row
                icon={<SoundIcon />}
                label="SOUND LEVEL"
                value={apiData.sound !== null ? `${apiData.sound} dB` : 'N/A'}
              />
            </>
          )}
        </View>
      )}

      <Spacer />
      <Line text="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" />
      <Spacer />

      {/* Divergence Calculation Results */}
      <Line text="DIVERGENCE ANALYSIS" />
      <Spacer />

      <Row
        icon={<DivergenceIcon />}
        label="DIVERGENCE"
        value={divergence.toFixed(6)}
        color={category.color}
      />
      <Row
        icon={<Text style={{ fontSize: 16 }}>{category.emoji}</Text>}
        label="CATEGORY"
        value={category.label}
        color={category.color}
      />
      <Row
        icon={<Text style={{ fontSize: 16, color: '#fff' }}>🌐</Text>}
        label="WORLD LINE"
        value={worldLine}
        color={getWorldLineColor(worldLine)}
      />

      <Spacer />
      <Line text="COMPONENT SCORES" />
      <Spacer />

      <Text style={styles.text}>
        {'   '}Temperature: {normalizeTemperature(parseFloat(currentData.temperature) || 0).toFixed(3)} (30% weight)
      </Text>
      <Text style={styles.text}>
        {'   '}Humidity: {normalizeHumidity(parseFloat(currentData.humidity) || 0).toFixed(3)} (20% weight)
      </Text>
      <Text style={styles.text}>
        {'   '}IAQ: {normalizeIAQ(parseFloat(currentData.iaq) || 0).toFixed(3)} (25% weight)
      </Text>
      <Text style={styles.text}>
        {'   '}Light: {normalizeLux(parseFloat(currentData.lux) || 0).toFixed(3)} (10% weight)
      </Text>
      <Text style={styles.text}>
        {'   '}Sound: {normalizeSound(parseFloat(currentData.sound) || 0).toFixed(3)} (15% weight)
      </Text>
    </View>
  );
}

/* ===================== DOCUMENTATION MODE ===================== */

function DocumentationMode() {
  return (
    <View>
      <Line text="HARDWARE DOCUMENTATION" />
      <Spacer />

      {/* Component List */}
      <Line text="SYSTEM COMPONENTS:" />
      <Spacer />
      <Text style={styles.text}>   • ESP32 MODULE</Text>
      <Text style={styles.text}>   • LDR LIGHT SENSOR</Text>
      <Text style={styles.text}>   • MQ-135 GAS/AIR QUALITY SENSOR</Text>
      <Text style={styles.text}>   • DHT-11 TEMP/HUMIDITY SENSOR</Text>
      <Text style={styles.text}>   • SOUND SENSOR MODULE</Text>
      <Text style={styles.text}>   • ATORSE 8-BIT LED DISPLAY</Text>
      <Text style={styles.text}>   • 2.4" SPI TFT DISPLAY</Text>
      <Spacer />

      {/* Documentation Sections */}
      <DocSection
        title="ESP32 MODULE"
        content="The ESP32, developed by Espressif Systems, is a low-cost, low-power System-on-Chip (SoC) with integrated Wi-Fi and Bluetooth capabilities, making it a versatile choice for a wide range of connected applications. It is widely used in IoT, home automation, wearables, and industrial control systems due to its rich feature set and flexibility."
      />

      <DocSection
        title="LDR LIGHT SENSOR"
        content="Light Dependent Resistor: A passive electronic component that changes its resistance based on light intensity. It decreases resistance as light increases, commonly used in light-sensing applications."
      />

      <DocSection
        title="MQ-135 GAS/AIR QUALITY SENSOR"
        content="The MQ-135 gas sensor is an air quality sensor used to detect a variety of harmful gases, including ammonia, nitrogen oxide, benzene, smoke, and carbon dioxide. It operates at a voltage of 5V and consumes about 150mA of current. The sensor is commonly used in environmental monitoring systems and IoT applications to measure air quality. It provides output in both digital and analog formats, making it versatile for various applications."
      />

      <DocSection
        title="DHT-11 TEMPERATURE/HUMIDITY SENSOR"
        content="The DHT11 is a widely used temperature and humidity sensor that measures temperature in the range of 0 to 50°C and relative humidity from 20 to 90% RH. It utilizes a single-wire digital interface to output the data, making it easy to connect to microcontrollers like Arduino. The sensor is ideal for educational projects due to its low cost and simplicity, allowing beginners to learn about environmental sensing."
      />

      <DocSection
        title="SOUND SENSOR"
        content="A sound sensor is a device that detects sound signals, such as voice, claps, or knocks, and converts them into electrical signals. It typically consists of a diaphragm that vibrates in response to sound waves, along with components like a capacitive microphone, peak detector, and amplifier. Sound sensors can measure sound intensity and are used in various applications, from simple clap switches to complex audio recording systems."
      />

      <DocSection
        title="ATORSE 8-BIT LED DISPLAY"
        content="The ATORSE 8 bit LED is a versatile digital display module that can be used in various applications, including DIY projects, educational tools, and industrial displays. It features an 8-bit digital tube display, which allows for easy and efficient control of multiple LED displays. The module is compatible with microcontrollers and can be used to create interactive displays that respond to user inputs."
      />

      <DocSection
        title='2.4" SPI TFT DISPLAY'
        content="The 2.4 inch SPI TFT display is a compact and versatile display module that is widely used in various applications. It features a 240x320 resolution, which is ideal for cost-effective embedded GUIs and status displays. The display is built on a TN panel with a 6 o'clock viewing direction, making it suitable for applications where the screen is typically viewed from above or straight-on. The module supports a 40-pin SPI/RGB interface and includes the ILI9341V driver IC."
      />

      <Spacer />
      <Line text="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" />
      <Spacer />

      {/* Divergence Model Documentation */}
      <Line text="DIVERGENCE MODEL DOCUMENTATION" />
      <Spacer />

      <DocSection
        title="WEIGHT DISTRIBUTION"
        content="Temperature: 30% (immediate physiological impact), IAQ/VOC: 25% (invisible stressor), Humidity: 20% (modulates thermal stress), Sound: 15% (chronic health impact), Light: 10% (wide tolerance)."
      />

      <DocSection
        title="WORLD LINE CLASSIFICATION"
        content="STEINS (≥0.90): Perfect environment. GAMMA (0.60-0.79): Acceptable conditions. BETA (0.20-0.59): Poor environment. ALPHA (<0.20): Severe instability. TRANSITION (0.80-0.89): Excellent but not perfect."
      />

      <DocSection
        title="NORMALIZATION RANGES"
        content="Temperature optimal: 22.2-25.6°C. Humidity optimal: 40-50%. IAQ excellent: 0-50. Luminosity ideal: 300-500 lux. Sound ideal: ≤30 dB."
      />

      <Spacer />
      <Line text="END OF DOCUMENTATION" />
    </View>
  );
}

/* ===================== WORLD MAP ===================== */

function WorldMap({ coords }) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const lat = Math.max(-90, Math.min(90, coords.lat));
  const lon = Math.max(-180, Math.min(180, coords.lon));

  const x = size.width ? ((lon + 180) / 360) * size.width : 0;
  const y = size.height ? ((90 - lat) / 180) * size.height : 0;

  return (
    <View
      style={styles.mapBox}
      onLayout={(e) => {
        const width = e.nativeEvent.layout.width;
        setSize({ width, height: width / 2 });
      }}>
      <Image
        source={MAP_SOURCE}
        style={{ width: '100%', height: size.height }}
        resizeMode="contain"
      />

      {size.width > 0 && (
        <Svg
          width={size.width}
          height={size.height}
          style={{ position: 'absolute', top: 0, left: 0 }}>
          <Circle cx={x} cy={y} r="5" fill="#00ff88" />
        </Svg>
      )}
    </View>
  );
}

/* ===================== REUSABLE COMPONENTS ===================== */

function TerminalPanel({ children }) {
  return <View style={styles.panel}>{children}</View>;
}

function Line({ text }) {
  return (
    <Text style={styles.text}>
      {'> '}
      {text}
    </Text>
  );
}

function Row({ icon, label, value, color }) {
  return (
    <View style={styles.row}>
      {icon}
      <Text style={[styles.text, color && { color }]}>
        {' '}
        {label.padEnd(14)} : {value}
      </Text>
    </View>
  );
}

function Spacer() {
  return <Text style={styles.text}> </Text>;
}

function TabButton({ label, active, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.tabButton}>
      <Text style={[styles.tabButtonText, active && styles.tabButtonActive]}>
        [{label}]
      </Text>
    </TouchableOpacity>
  );
}

function InputRow({ label, value, onChangeText, placeholder }) {
  return (
    <View style={styles.inputRow}>
      <Text style={styles.inputLabel}>
        {'> '}
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#004422"
        style={styles.inputField}
        keyboardType="numeric"
      />
    </View>
  );
}

function DocSection({ title, content }) {
  return (
    <View>
      <Spacer />
      <Line text={title} />
      <Spacer />
      <Text style={styles.docText}>   {content}</Text>
      <Spacer />
    </View>
  );
}

/* ===================== ICONS ===================== */

const BaseIcon = ({ children }) => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
    {children}
  </Svg>
);

const TempIcon = () => (
  <BaseIcon>
    <Path
      stroke="#00ff88"
      strokeWidth={1.5}
      d="M10 14a2 2 0 104 0V6a2 2 0 10-4 0v8z"
    />
  </BaseIcon>
);

const HumidityIcon = () => (
  <BaseIcon>
    <Path
      stroke="#00ff88"
      strokeWidth={1.5}
      d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"
    />
  </BaseIcon>
);

const AqiIcon = () => (
  <BaseIcon>
    <Path
      stroke="#00ff88"
      strokeWidth={1.5}
      d="M4 14s2-2 4-2 4 2 6 2 4-2 6-2"
    />
  </BaseIcon>
);

const LightIcon = () => (
  <BaseIcon>
    <Path
      stroke="#00ff88"
      strokeWidth={1.5}
      d="M12 3a5 5 0 00-3 9v4h6v-4a5 5 0 00-3-9z"
    />
  </BaseIcon>
);

const SoundIcon = () => (
  <BaseIcon>
    <Path
      stroke="#00ff88"
      strokeWidth={1.5}
      d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 010 7.07"
    />
  </BaseIcon>
);

const DivergenceIcon = () => (
  <BaseIcon>
    <Path stroke="#00ff88" strokeWidth={1.5} d="M12 6v12M6 12h12" />
  </BaseIcon>
);

const ChipIcon = () => (
  <BaseIcon>
    <Path stroke="#00ff88" strokeWidth={1.5} d="M7 7h10v10H7z" />
  </BaseIcon>
);

/* ===================== STYLES ===================== */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#003322',
  },
  headerText: {
    color: '#00ff88',
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  subHeader: {
    color: '#00ff88',
    fontFamily: 'monospace',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 4,
    opacity: 0.7,
  },
  content: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  panel: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#00ff88',
    padding: 12,
    marginBottom: 80,
  },
  text: {
    color: '#00ff88',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 22,
  },
  docText: {
    color: '#00ff88',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 20,
    opacity: 0.9,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 20,
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderTopColor: '#003322',
  },
  tabButton: {
    paddingHorizontal: 10,
  },
  tabButtonText: {
    color: '#00ff88',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  tabButtonActive: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  command: {
    color: '#00ff88',
    fontFamily: 'monospace',
    fontSize: 12,
    marginVertical: 6,
  },
  input: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#00ff88',
    color: '#00ff88',
    fontFamily: 'monospace',
    padding: 8,
    marginVertical: 6,
    fontSize: 13,
  },
  inputRow: {
    marginVertical: 4,
  },
  inputLabel: {
    color: '#00ff88',
    fontFamily: 'monospace',
    fontSize: 13,
    marginBottom: 4,
  },
  inputField: {
    borderWidth: 1,
    borderColor: '#00ff88',
    color: '#00ff88',
    fontFamily: 'monospace',
    padding: 6,
    fontSize: 13,
    marginLeft: 16,
  },
  modeToggle: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#00ff88',
    padding: 10,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: '#00ff88',
  },
  modeButtonText: {
    color: '#00ff88',
    fontFamily: 'monospace',
    fontSize: 11,
  },
  modeButtonTextActive: {
    color: '#000',
    fontWeight: 'bold',
  },
  searchResults: {
    marginVertical: 8,
  },
  mapBox: {
    width: '100%',
    backgroundColor: '#000',
    position: 'relative',
    marginVertical: 8,
  },
});