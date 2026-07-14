import 'server-only';
import { log, errFields } from '@/lib/log';

export interface WeatherData {
  temperature: number;
  conditionCode: number;
  conditionText: string;
  sunrise: string; // HH:mm
  sunset: string; // HH:mm
  sunriseMinutes: number;
  sunsetMinutes: number;
}

/**
 * Fetches real-time weather and ephemeris data for Alexandria, Egypt.
 * Uses Open-Meteo (free, no API key required, secure HTTPS).
 */
export async function getAlexandriaWeather(locale: string = 'en'): Promise<WeatherData> {
  const lat = 31.2862;
  const lon = 30.0125;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=Africa%2FCairo&forecast_days=1`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (!res.ok) {
      throw new Error(`Weather API returned ${res.status}`);
    }

    const data = await res.json();

    const currentTemp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const sunriseStr = data.daily.sunrise[0]; // e.g. "2026-05-31T05:56"
    const sunsetStr = data.daily.sunset[0]; // e.g. "2026-05-31T18:42"

    const sunriseDate = new Date(sunriseStr);
    const sunsetDate = new Date(sunsetStr);

    const sunriseMinutes = sunriseDate.getHours() * 60 + sunriseDate.getMinutes();
    const sunsetMinutes = sunsetDate.getHours() * 60 + sunsetDate.getMinutes();

    const fmt = (d: Date) => 
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    return {
      temperature: currentTemp,
      conditionCode: code,
      conditionText: mapWeatherCode(code, locale),
      sunrise: fmt(sunriseDate),
      sunset: fmt(sunsetDate),
      sunriseMinutes,
      sunsetMinutes,
    };
  } catch (err) {
    log.error('Failed to fetch weather', { ...errFields(err) });
    // Fallback to design defaults if the API is down
    return {
      temperature: 27,
      conditionCode: 0,
      conditionText: locale === 'ar' ? 'شمس خفيفة' : 'Hazy sun',
      sunrise: '05:56',
      sunset: '18:42',
      sunriseMinutes: 5 * 60 + 56,
      sunsetMinutes: 18 * 60 + 42,
    };
  }
}

/**
 * WMO Weather interpretation codes (WW)
 * https://open-meteo.com/en/docs
 */
function mapWeatherCode(code: number, locale: string): string {
  const isAr = locale === 'ar';
  if (code === 0) return isAr ? 'سماء صافية' : 'Clear sky';
  if (code <= 3) return isAr ? 'صافٍ غالباً' : 'Mainly clear';
  if (code <= 48) return isAr ? 'ضبابي' : 'Foggy';
  if (code <= 57) return isAr ? 'رذاذ' : 'Drizzle';
  if (code <= 67) return isAr ? 'مطر' : 'Rain';
  if (code <= 77) return isAr ? 'ثلج' : 'Snow';
  if (code <= 82) return isAr ? 'زخات مطر' : 'Rain showers';
  if (code <= 86) return isAr ? 'زخات ثلج' : 'Snow showers';
  if (code === 95) return isAr ? 'عاصفة رعدية' : 'Thunderstorm';
  if (code >= 96) return isAr ? 'عاصفة رعدية مع برد' : 'Thunderstorm with hail';
  return isAr ? 'صافٍ' : 'Clear';
}
