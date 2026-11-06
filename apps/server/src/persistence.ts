import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PolaroidEntry, WeatherStateId, WindChimeNote } from '@dalat/protocol';

const DATA_FILE_PATH = fileURLToPath(new URL('../data/world_memory.json', import.meta.url));
const MAX_POLAROIDS = 24;
const MAX_WIND_CHIMES = 30;
const MAX_IMAGE_DATA_LEN = 450_000;

const BLOCKED_WORDS_RE =
  /\b(fuck|shit|bitch|asshole|dick|cunt|nigger|faggot|đụ|địt|lồn|cặc|đéo|vãi lồn|đĩ|chó đẻ)\b/gi;

export function sanitizeSocialText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  const collapsed = raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  return collapsed.replace(BLOCKED_WORDS_RE, '***');
}

function makeStarterSvgDataUrl(opts: {
  skyTop: string;
  skyBottom: string;
  cloudTop: string;
  cloudShadow: string;
  ridge: string;
  accent: string;
  sunCx: number;
  sunCy: number;
  stars?: boolean;
  turbines?: boolean;
  lanternGlow?: boolean;
}): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 320">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${opts.skyTop}"/>
      <stop offset="100%" stop-color="${opts.skyBottom}"/>
    </linearGradient>
    <linearGradient id="cloud" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${opts.cloudTop}"/>
      <stop offset="100%" stop-color="${opts.cloudShadow}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="320" fill="url(#sky)"/>
  ${
    opts.stars
      ? '<circle cx="62" cy="44" r="1.4" fill="#FFF7D6" opacity="0.8"/><circle cx="148" cy="29" r="1.2" fill="#FFF7D6" opacity="0.7"/><circle cx="295" cy="52" r="1.5" fill="#FFF7D6" opacity="0.85"/><circle cx="348" cy="34" r="1.1" fill="#FFF7D6" opacity="0.65"/>'
      : ''
  }
  <circle cx="${opts.sunCx}" cy="${opts.sunCy}" r="36" fill="${opts.accent}" opacity="0.32"/>
  <circle cx="${opts.sunCx}" cy="${opts.sunCy}" r="20" fill="${opts.accent}" opacity="0.92"/>
  <path d="M0 190 Q95 154 195 182 T400 172 L400 320 L0 320 Z" fill="${opts.ridge}" opacity="0.55"/>
  ${
    opts.turbines
      ? '<g stroke="#FFF8EB" stroke-width="2" opacity="0.85"><line x1="255" y1="145" x2="255" y2="195"/><line x1="255" y1="145" x2="243" y2="132"/><line x1="255" y1="145" x2="269" y2="138"/><line x1="255" y1="145" x2="252" y2="161"/><line x1="312" y1="152" x2="312" y2="198"/><line x1="312" y1="152" x2="300" y2="140"/><line x1="312" y1="152" x2="325" y2="146"/><line x1="312" y1="152" x2="310" y2="167"/></g>'
      : ''
  }
  <path d="M-10 212 C45 194, 98 225, 155 208 C215 192, 272 222, 335 204 C368 195, 392 206, 410 202 L410 320 L-10 320 Z" fill="url(#cloud)"/>
  ${
    opts.lanternGlow
      ? '<ellipse cx="215" cy="248" rx="95" ry="18" fill="#FFB347" opacity="0.48"/><ellipse cx="145" cy="262" rx="64" ry="12" fill="#FFD27D" opacity="0.42"/>'
      : ''
  }
  <path d="M0 246 L68 218 L142 254 L224 238 L322 268 L400 242 L400 320 L0 320 Z" fill="${opts.ridge}"/>
  <g fill="#16261E">
    <polygon points="48,186 33,248 63,248"/>
    <polygon points="48,168 36,216 60,216"/>
    <polygon points="84,198 71,252 97,252"/>
  </g>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function createSeedPolaroids(): PolaroidEntry[] {
  const now = Date.now();
  return [
    {
      id: 'seed-polaroid-1',
      authorName: 'Minh Thư',
      caption: 'Biển mây đầu mùa tràn qua đồi chè cổ, nắng ấm đến tận đầu ngón tay ✨',
      landmarkId: 'cau-go-san-may',
      landmarkName: 'Cầu Gỗ Săn Mây Cầu Đất',
      weatherId: 'golden_cloud_sea',
      gameTimeLabel: '05:32 AM',
      altitudeASL: 1648,
      imageDataUrl: makeStarterSvgDataUrl({
        skyTop: '#24355C',
        skyBottom: '#FFB37B',
        cloudTop: '#FFF3E2',
        cloudShadow: '#7D95BA',
        ridge: '#243A31',
        accent: '#FFD584',
        sunCx: 282,
        sunCy: 132,
        turbines: true,
      }),
      likes: 18,
      createdAt: now - 1000 * 60 * 42,
    },
    {
      id: 'seed-polaroid-2',
      authorName: 'Hoàng Nam',
      caption: '4h40 sáng chạy xe Cub lên đồi, dưới chân là cả ngân hà nhà lồng Thái Phiên 🏮',
      landmarkId: 'dai-ngam-den',
      landmarkName: 'Đài Ngắm Thung Lũng Đèn & Dốc Dã Quỳ',
      weatherId: 'golden_cloud_sea',
      gameTimeLabel: '04:42 AM',
      altitudeASL: 1534,
      imageDataUrl: makeStarterSvgDataUrl({
        skyTop: '#111B30',
        skyBottom: '#434E78',
        cloudTop: '#5E729C',
        cloudShadow: '#232F4D',
        ridge: '#18242B',
        accent: '#F6BD60',
        sunCx: 318,
        sunCy: 175,
        stars: true,
        lanternGlow: true,
      }),
      likes: 23,
      createdAt: now - 1000 * 60 * 95,
    },
    {
      id: 'seed-polaroid-3',
      authorName: 'An Nhiên',
      caption: 'Ly sữa đậu nành nóng bên hiên gỗ thông, nghe tiếng guitar mộc giữa sương mai ☕',
      landmarkId: 'quan-mo-suong',
      landmarkName: 'Tiệm Cà Phê Gỗ "Mơ Sương"',
      weatherId: 'morning_mist_boil',
      gameTimeLabel: '06:50 AM',
      altitudeASL: 1585,
      imageDataUrl: makeStarterSvgDataUrl({
        skyTop: '#3E7CB8',
        skyBottom: '#FCE1B6',
        cloudTop: '#FFFFFF',
        cloudShadow: '#9CB4CE',
        ridge: '#2E4A3E',
        accent: '#FFE8B3',
        sunCx: 245,
        sunCy: 96,
      }),
      likes: 14,
      createdAt: now - 1000 * 60 * 150,
    },
  ];
}

function createSeedWindChimes(): WindChimeNote[] {
  const now = Date.now();
  return [
    {
      id: 'seed-chime-1',
      authorName: 'Thảo Vy',
      message: 'Mong những người thương nhau sẽ luôn tìm thấy nhau giữa sương mù Đà Lạt.',
      createdAt: now - 1000 * 60 * 18,
    },
    {
      id: 'seed-chime-2',
      authorName: 'Bảo Khánh',
      message: 'Chúc bản thân tuổi mới bình yên như sáng sớm ngồi nghe gió đồi Cầu Đất.',
      createdAt: now - 1000 * 60 * 47,
    },
    {
      id: 'seed-chime-3',
      authorName: 'Minh Khôi',
      message: 'Hẹn một ngày quay lại cùng người ấy ngắm bình minh 5 giờ sáng trên cầu gỗ.',
      createdAt: now - 1000 * 60 * 88,
    },
    {
      id: 'seed-chime-4',
      authorName: 'Lan Anh',
      message: 'Gửi lại hết muộn phiền cho mây trời Langbiang, mang về một trái tim thật ấm.',
      createdAt: now - 1000 * 60 * 135,
    },
    {
      id: 'seed-chime-5',
      authorName: 'Đức Duy',
      message: 'Cảm ơn Đà Lạt vì ly cà phê phin nóng và những nụ cười lạ mà quen.',
      createdAt: now - 1000 * 60 * 210,
    },
  ];
}

interface WorldMemoryDiskFormat {
  polaroids: PolaroidEntry[];
  windChimeNotes: WindChimeNote[];
  updatedAt: number;
}

const VALID_WEATHERS = new Set<WeatherStateId>([
  'golden_cloud_sea',
  'morning_mist_boil',
  'clear_highland_sun',
  'cloudy_breeze',
  'deep_evening_fog',
  'light_drizzle',
]);

class WorldPersistenceStore {
  private polaroids: PolaroidEntry[] = [];
  private windChimeNotes: WindChimeNote[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly supabaseUrl = process.env.SUPABASE_URL?.trim() || '';
  private readonly supabaseKey = process.env.SUPABASE_ANON_KEY?.trim() || '';

  constructor() {
    this.loadFromDisk();
    if (this.supabaseUrl && this.supabaseKey) {
      void this.hydrateFromSupabase();
    }
  }

  private loadFromDisk(): void {
    try {
      const dir = dirname(DATA_FILE_PATH);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      if (existsSync(DATA_FILE_PATH)) {
        const raw = readFileSync(DATA_FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw) as Partial<WorldMemoryDiskFormat>;
        if (Array.isArray(parsed.polaroids) && parsed.polaroids.length > 0) {
          this.polaroids = parsed.polaroids.slice(0, MAX_POLAROIDS);
        }
        if (Array.isArray(parsed.windChimeNotes) && parsed.windChimeNotes.length > 0) {
          this.windChimeNotes = parsed.windChimeNotes.slice(0, MAX_WIND_CHIMES);
        }
      }
    } catch {
      // Fallback to poetic starter seeds below
    }

    let seeded = false;
    if (this.polaroids.length === 0) {
      this.polaroids = createSeedPolaroids();
      seeded = true;
    }
    if (this.windChimeNotes.length === 0) {
      this.windChimeNotes = createSeedWindChimes();
      seeded = true;
    }
    if (seeded) {
      this.flushToDiskNow();
    }
  }

  private scheduleDiskFlush(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushToDiskNow();
    }, 250);
  }

  public flushToDiskNow(): void {
    try {
      const dir = dirname(DATA_FILE_PATH);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const payload: WorldMemoryDiskFormat = {
        polaroids: this.polaroids.slice(0, MAX_POLAROIDS),
        windChimeNotes: this.windChimeNotes.slice(0, MAX_WIND_CHIMES),
        updatedAt: Date.now(),
      };
      const tmpPath = `${DATA_FILE_PATH}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      renameSync(tmpPath, DATA_FILE_PATH);
    } catch {
      // Keep in-memory state intact if disk is read-only
    }
  }

  private async hydrateFromSupabase(): Promise<void> {
    try {
      const headers = {
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
      };
      const [polRes, chimeRes] = await Promise.all([
        fetch(`${this.supabaseUrl}/rest/v1/polaroids?select=*&order=createdAt.desc&limit=${MAX_POLAROIDS}`, {
          headers,
          signal: AbortSignal.timeout(3500),
        }),
        fetch(`${this.supabaseUrl}/rest/v1/wind_chimes?select=*&order=createdAt.desc&limit=${MAX_WIND_CHIMES}`, {
          headers,
          signal: AbortSignal.timeout(3500),
        }),
      ]);

      if (polRes.ok) {
        const rows = (await polRes.json()) as PolaroidEntry[];
        if (Array.isArray(rows) && rows.length > 0) {
          this.polaroids = rows.slice(0, MAX_POLAROIDS);
        }
      }
      if (chimeRes.ok) {
        const rows = (await chimeRes.json()) as WindChimeNote[];
        if (Array.isArray(rows) && rows.length > 0) {
          this.windChimeNotes = rows.slice(0, MAX_WIND_CHIMES);
        }
      }
      this.scheduleDiskFlush();
    } catch {
      // Non-fatal optional cloud persistence hook
    }
  }

  private mirrorToSupabase(table: string, method: 'POST' | 'PATCH', query: string, body: unknown): void {
    if (!this.supabaseUrl || !this.supabaseKey) return;
    void fetch(`${this.supabaseUrl}/rest/v1/${table}${query}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.supabaseKey,
        Authorization: `Bearer ${this.supabaseKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
  }

  public getPolaroids(): PolaroidEntry[] {
    return this.polaroids.slice(0, MAX_POLAROIDS);
  }

  public getWindChimeNotes(): WindChimeNote[] {
    return this.windChimeNotes.slice(0, MAX_WIND_CHIMES);
  }

  public addPolaroid(input: Partial<Omit<PolaroidEntry, 'id' | 'likes' | 'createdAt'>>, fallbackAuthor: string): PolaroidEntry | null {
    const rawImage = typeof input.imageDataUrl === 'string' ? input.imageDataUrl.trim() : '';
    if (!rawImage.startsWith('data:image/') || rawImage.length > MAX_IMAGE_DATA_LEN) {
      return null;
    }

    const authorName = sanitizeSocialText(input.authorName || fallbackAuthor, 28) || 'Lữ Khách';
    const caption =
      sanitizeSocialText(input.caption, 140) || 'Một sớm săn mây bình yên trên đồi Cầu Đất ✨';
    const landmarkId = sanitizeSocialText(input.landmarkId, 40) || 'cau-go-san-may';
    const landmarkName =
      sanitizeSocialText(input.landmarkName, 64) || 'Đồi Chè Cầu Đất';
    const weatherId: WeatherStateId =
      typeof input.weatherId === 'string' && VALID_WEATHERS.has(input.weatherId as WeatherStateId)
        ? (input.weatherId as WeatherStateId)
        : 'golden_cloud_sea';
    const gameTimeLabel = sanitizeSocialText(input.gameTimeLabel, 16) || '05:30 AM';
    const altitudeASL =
      typeof input.altitudeASL === 'number' && Number.isFinite(input.altitudeASL)
        ? Math.round(Math.max(1200, Math.min(2500, input.altitudeASL)))
        : 1620;

    const entry: PolaroidEntry = {
      id: `pol-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      authorName,
      caption,
      landmarkId,
      landmarkName,
      weatherId,
      gameTimeLabel,
      altitudeASL,
      imageDataUrl: rawImage,
      likes: 1,
      createdAt: Date.now(),
    };

    this.polaroids = [entry, ...this.polaroids].slice(0, MAX_POLAROIDS);
    this.scheduleDiskFlush();
    this.mirrorToSupabase('polaroids', 'POST', '', entry);
    return entry;
  }

  public likePolaroid(polaroidId: string): { id: string; likes: number } | null {
    if (typeof polaroidId !== 'string' || !polaroidId) return null;
    const found = this.polaroids.find((p) => p.id === polaroidId);
    if (!found) return null;
    found.likes = Math.min(99_999, (found.likes || 0) + 1);
    this.scheduleDiskFlush();
    this.mirrorToSupabase('polaroids', 'PATCH', `?id=eq.${encodeURIComponent(polaroidId)}`, {
      likes: found.likes,
    });
    return { id: found.id, likes: found.likes };
  }

  public addWindChime(rawMessage: unknown, author: string): WindChimeNote | null {
    const message = sanitizeSocialText(rawMessage, 140);
    if (message.length < 2) return null;
    const authorName = sanitizeSocialText(author, 28) || 'Lữ Khách';

    const note: WindChimeNote = {
      id: `chime-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      authorName,
      message,
      createdAt: Date.now(),
    };

    this.windChimeNotes = [note, ...this.windChimeNotes].slice(0, MAX_WIND_CHIMES);
    this.scheduleDiskFlush();
    this.mirrorToSupabase('wind_chimes', 'POST', '', note);
    return note;
  }
}

export const worldPersistence = new WorldPersistenceStore();
