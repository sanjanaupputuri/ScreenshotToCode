import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'database.sqlite');

let db;
let initializationPromise;

function openDb() {
  if (db) return db;
  db = new sqlite3.Database(DB_PATH);
  return db;
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    openDb().exec(sql, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    openDb().run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    openDb().get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row ?? null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    openDb().all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows ?? []);
    });
  });
}

async function withTransaction(callback) {
  await exec('BEGIN');
  try {
    const result = await callback();
    await exec('COMMIT');
    return result;
  } catch (error) {
    try {
      await exec('ROLLBACK');
    } catch {
      // Ignore rollback failure and surface the original error.
    }
    throw error;
  }
}

export async function initializeDatabase() {
  if (initializationPromise) {
    await initializationPromise;
    return;
  }

  initializationPromise = (async () => {
    await exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS generated_codes (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        code TEXT,
        image_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS components (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        html_template TEXT NOT NULL,
        css_template TEXT,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS component_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        component_id INTEGER,
        rule_type TEXT NOT NULL,
        min_value REAL,
        max_value REAL,
        text_condition TEXT,
        color_condition TEXT,
        FOREIGN KEY (component_id) REFERENCES components(id)
      );

      CREATE TABLE IF NOT EXISTS colors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hex_value TEXT UNIQUE NOT NULL,
        tailwind_class TEXT NOT NULL,
        category TEXT NOT NULL,
        color_name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS spacing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pixel_value INTEGER UNIQUE NOT NULL,
        tailwind_class TEXT NOT NULL,
        rem_value REAL NOT NULL,
        spacing_type TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS primitive_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        base_kind TEXT NOT NULL,
        target_type TEXT NOT NULL,
        min_aspect REAL,
        max_aspect REAL,
        min_width REAL,
        max_width REAL,
        min_height REAL,
        max_height REAL,
        text_pattern TEXT,
        fill_mode TEXT,
        z_index INTEGER DEFAULT 10,
        priority INTEGER DEFAULT 1,
        text_role TEXT,
        description TEXT
      );
    `);

    await populateInitialData();
    console.log('SQLite database initialized');
  })();

  try {
    await initializationPromise;
  } catch (error) {
    initializationPromise = null;
    throw error;
  }
}

async function populateInitialData() {
  const componentCount = (await get('SELECT COUNT(*) as c FROM components'))?.c ?? 0;
  const primitiveProfileCount = (await get('SELECT COUNT(*) as c FROM primitive_profiles'))?.c ?? 0;
  const colorCount = (await get('SELECT COUNT(*) as c FROM colors'))?.c ?? 0;
  const spacingCount = (await get('SELECT COUNT(*) as c FROM spacing'))?.c ?? 0;

  if (componentCount > 0 && primitiveProfileCount > 0 && colorCount > 0 && spacingCount > 0) return;

  const components = [
    [1, 'button_primary', 'form', '<button class="{{classes}}">{{text}}</button>', '', 'Primary button'],
    [2, 'input_text', 'form', '<input type="text" class="{{classes}}" placeholder="{{text}}" />', '', 'Text input'],
    [3, 'heading_h1', 'typography', '<h1 class="{{classes}}">{{text}}</h1>', '', 'H1 heading'],
    [4, 'heading_h2', 'typography', '<h2 class="{{classes}}">{{text}}</h2>', '', 'H2 heading'],
    [5, 'card_basic', 'layout', '<div class="{{classes}}">{{content}}</div>', '', 'Card container'],
    [6, 'paragraph', 'typography', '<p class="{{classes}}">{{text}}</p>', '', 'Paragraph'],
    [7, 'nav_link', 'navigation', '<a href="#" class="{{classes}}">{{text}}</a>', '', 'Nav link'],
    [8, 'image_basic', 'media', '<img src="{{src}}" class="{{classes}}" alt="{{alt}}" />', '', 'Image'],
  ];

  const rules = [
    [1, 'aspect_ratio', 2.0, 6.0, 'required', 'bright'],
    [1, 'width', 60, 350, null, null],
    [1, 'height', 25, 65, null, null],
    [2, 'aspect_ratio', 4.0, 15.0, 'optional', 'neutral'],
    [2, 'width', 100, 500, null, null],
    [2, 'height', 20, 55, null, null],
    [3, 'height', 45, 100, 'required', 'any'],
    [3, 'width', 200, 800, null, null],
    [4, 'height', 30, 65, 'required', 'any'],
    [4, 'width', 150, 700, null, null],
    [5, 'aspect_ratio', 0.5, 2.5, 'optional', 'any'],
    [5, 'width', 150, 800, null, null],
    [5, 'height', 100, 600, null, null],
    [6, 'aspect_ratio', 3.0, 20.0, 'required', 'any'],
    [6, 'width', 200, 900, null, null],
    [8, 'width', 100, 1000, null, null],
    [8, 'height', 100, 800, null, null],
  ];

  const colors = [
    ['#3B82F6', 'bg-blue-500 text-white', 'primary', 'Blue'],
    ['#EF4444', 'bg-red-500 text-white', 'danger', 'Red'],
    ['#10B981', 'bg-green-500 text-white', 'success', 'Green'],
    ['#F59E0B', 'bg-yellow-500', 'warning', 'Yellow'],
    ['#6B7280', 'bg-gray-500 text-white', 'neutral', 'Gray'],
    ['#FFFFFF', 'bg-white border', 'neutral', 'White'],
    ['#000000', 'bg-black text-white', 'neutral', 'Black'],
    ['#1877F2', 'bg-blue-600 text-white', 'primary', 'Facebook Blue'],
    ['#F3F4F6', 'bg-gray-100', 'neutral', 'Light Gray'],
  ];

  const spacing = [
    [4, 'p-1', 0.25, 'padding'], [8, 'p-2', 0.5, 'padding'],
    [12, 'p-3', 0.75, 'padding'], [16, 'p-4', 1.0, 'padding'],
    [20, 'p-5', 1.25, 'padding'], [24, 'p-6', 1.5, 'padding'],
    [32, 'p-8', 2.0, 'padding'], [48, 'p-12', 3.0, 'padding'],
  ];

  const primitiveProfiles = [
    ['page_toolbar', 'shape', 'toolbar', 4.0, 80.0, 300, 5000, 24, 96, null, 'filled', 4, 9, 'chrome', 'Top browser or app toolbar'],
    ['filled_button', 'shape', 'button', 1.8, 12.0, 40, 420, 22, 72, null, 'filled', 12, 8, 'action', 'Filled action button'],
    ['border_input', 'shape', 'input', 2.5, 24.0, 80, 1200, 20, 72, null, 'outlined', 11, 8, 'field', 'Outlined input field'],
    ['tab_chip', 'shape', 'chip', 1.5, 12.0, 24, 400, 16, 56, null, 'outlined', 10, 7, 'tab', 'Tab, filter, or chip'],
    ['icon_glyph', 'shape', 'icon', 0.65, 1.35, 8, 80, 8, 80, null, 'any', 14, 8, 'icon', 'Icon glyph or badge'],
    ['avatar_circle', 'shape', 'avatar', 0.75, 1.25, 20, 140, 20, 140, null, 'any', 15, 8, 'avatar', 'Avatar or circular marker'],
    ['panel_container', 'shape', 'panel', 0.4, 50.0, 40, 5000, 24, 3000, null, 'any', 6, 5, 'container', 'Layout container or card'],
    ['repo_title', 'text', 'title', 1.8, 40.0, 80, 2400, 18, 120, '(repo|firetruck|readme|issues|pull|actions|projects|insights|settings)', 'any', 30, 10, 'title', 'Repository heading or prominent nav text'],
    ['nav_text', 'text', 'nav_text', 1.0, 40.0, 10, 1200, 10, 48, '(code|issues|wiki|pull|actions|projects|security|settings|fork|star|watch)', 'any', 24, 8, 'nav', 'Navigation text'],
    ['muted_label', 'text', 'muted_text', 1.0, 60.0, 8, 1400, 8, 40, '(public|commits|activity|releases|packages|published|create|upload|minute|ago)', 'any', 22, 7, 'muted', 'Secondary label text'],
    ['body_copy', 'text', 'body_text', 1.0, 80.0, 8, 2400, 8, 52, null, 'any', 20, 3, 'body', 'General body copy'],
  ];

  const compNames = ['button_primary', 'input_text', 'heading_h1', 'heading_h2', 'card_basic', 'paragraph', 'nav_link', 'image_basic'];

  await withTransaction(async () => {
    for (const [, name, cat, html, css, desc] of components) {
      await run(
        'INSERT OR IGNORE INTO components (name, category, html_template, css_template, description) VALUES (?, ?, ?, ?, ?)',
        [name, cat, html, css, desc],
      );
    }

    for (const [idx, ruleType, min, max, textCond, colorCond] of rules) {
      const compId = (await get('SELECT id FROM components WHERE name = ?', [compNames[idx - 1]]))?.id;
      if (compId) {
        await run(
          'INSERT INTO component_rules (component_id, rule_type, min_value, max_value, text_condition, color_condition) VALUES (?, ?, ?, ?, ?, ?)',
          [compId, ruleType, min, max, textCond, colorCond],
        );
      }
    }

    for (const [hex, tw, cat, name] of colors) {
      await run(
        'INSERT OR IGNORE INTO colors (hex_value, tailwind_class, category, color_name) VALUES (?, ?, ?, ?)',
        [hex, tw, cat, name],
      );
    }

    for (const [px, tw, rem, type] of spacing) {
      await run(
        'INSERT OR IGNORE INTO spacing (pixel_value, tailwind_class, rem_value, spacing_type) VALUES (?, ?, ?, ?)',
        [px, tw, rem, type],
      );
    }

    for (const profile of primitiveProfiles) {
      await run(
        `INSERT OR IGNORE INTO primitive_profiles
        (name, base_kind, target_type, min_aspect, max_aspect, min_width, max_width, min_height, max_height, text_pattern, fill_mode, z_index, priority, text_role, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        profile,
      );
    }
  });

  console.log('Initial data populated');
}

export async function classifyElement(elementData) {
  await initializeDatabase();
  const { width, height, hasText, type, aspect_ratio } = elementData;
  const ar = aspect_ratio || (width / (height || 1));
  const hasTextVal = hasText ? 1 : 0;

  try {
    const row = await get(
      `SELECT c.id, c.name, c.category, COUNT(*) as score
       FROM components c
       JOIN component_rules cr ON c.id = cr.component_id
       WHERE (cr.rule_type = 'aspect_ratio' AND ? BETWEEN cr.min_value AND cr.max_value)
          OR (cr.rule_type = 'width' AND ? BETWEEN cr.min_value AND cr.max_value)
          OR (cr.rule_type = 'height' AND ? BETWEEN cr.min_value AND cr.max_value)
          OR (cr.text_condition = 'required' AND ? = 1)
          OR (cr.text_condition = 'optional')
       GROUP BY c.id, c.name, c.category
       ORDER BY score DESC
       LIMIT 1`,
      [ar, width, height, hasTextVal],
    );

    if (row && row.score > 0) {
      return row;
    }
  } catch (error) {
    console.warn('Classification query error:', error.message);
  }

  if (type) {
    const typeMapping = {
      button: 'button_primary',
      input: 'input_text',
      heading: 'heading_h1',
      paragraph: 'paragraph',
      card: 'card_basic',
      image: 'image_basic',
      navigation: 'nav_link',
      header: 'heading_h1',
    };

    const mappedName = typeMapping[type];
    if (mappedName) {
      const byType = await get('SELECT id, name, category FROM components WHERE name = ?', [mappedName]);
      if (byType) {
        return { ...byType, score: 5 };
      }
    }
  }

  const defaultComp = await get('SELECT id, name, category FROM components WHERE name = ?', ['card_basic']);
  return defaultComp ? { ...defaultComp, score: 0 } : null;
}

export async function getComponentTemplate(componentId) {
  await initializeDatabase();
  return get('SELECT html_template, css_template FROM components WHERE id = ?', [componentId]);
}

export async function getColorClass(hexColor) {
  await initializeDatabase();
  return get('SELECT tailwind_class FROM colors WHERE UPPER(hex_value) = UPPER(?)', [hexColor]);
}

export async function getSpacingClass(pixelValue) {
  await initializeDatabase();
  return get(
    'SELECT tailwind_class FROM spacing WHERE pixel_value <= ? ORDER BY pixel_value DESC LIMIT 1',
    [pixelValue],
  );
}

export async function saveUser(uid, email, name) {
  await initializeDatabase();
  await run('INSERT OR REPLACE INTO users (id, email, name) VALUES (?, ?, ?)', [uid, email, name]);
}

export async function saveGeneratedCode(userId, code, imageUrl) {
  await initializeDatabase();
  const id = crypto.randomUUID();
  await run('INSERT INTO generated_codes (id, user_id, code, image_url) VALUES (?, ?, ?, ?)', [id, userId, code, imageUrl]);
  return { id };
}

export async function getUserHistory(userId) {
  await initializeDatabase();
  return all(
    'SELECT id, user_id, image_url, created_at, SUBSTR(code, 1, 200) as code_preview, code FROM generated_codes WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [userId],
  );
}

function textMatchesPattern(text, pattern) {
  if (!pattern) return true;
  try {
    return new RegExp(pattern, 'i').test(text || '');
  } catch {
    return false;
  }
}

function fillModeForElement(element) {
  const background = String(element.background_color || '').toLowerCase();
  const borderWidth = Number(element.border_width) || 0;
  if (background && background !== 'transparent' && background !== '#ffffff' && background !== '#fff') return 'filled';
  if (borderWidth > 0) return 'outlined';
  return 'any';
}

function scoreProfileMatch(element, profile) {
  const aspect = (Number(element.width) || 1) / Math.max(Number(element.height) || 1, 1);
  const width = Number(element.width) || 0;
  const height = Number(element.height) || 0;
  const text = element.text || '';
  let score = 0;

  if (profile.base_kind !== (element.kind || 'shape')) return -1;
  if (
    element.kind === 'shape' &&
    element.type &&
    element.type !== 'shape' &&
    element.type !== 'text' &&
    profile.target_type !== element.type
  ) {
    return -1;
  }
  if (profile.min_aspect !== null && aspect < profile.min_aspect) return -1;
  if (profile.max_aspect !== null && aspect > profile.max_aspect) return -1;
  if (profile.min_width !== null && width < profile.min_width) return -1;
  if (profile.max_width !== null && width > profile.max_width) return -1;
  if (profile.min_height !== null && height < profile.min_height) return -1;
  if (profile.max_height !== null && height > profile.max_height) return -1;
  if (profile.fill_mode && profile.fill_mode !== 'any' && profile.fill_mode !== fillModeForElement(element)) return -1;
  if (!textMatchesPattern(text, profile.text_pattern)) return -1;

  score += profile.priority || 1;
  if ((element.type || '') === profile.target_type) score += 2;
  if (profile.text_pattern && text) score += 2;
  return score;
}

export async function enrichDetectedElements(elements = []) {
  await initializeDatabase();
  const profiles = await all('SELECT * FROM primitive_profiles ORDER BY priority DESC, id ASC');

  return elements.map((element) => {
    let bestProfile = null;
    let bestScore = -1;

    for (const profile of profiles) {
      const score = scoreProfileMatch(element, profile);
      if (score > bestScore) {
        bestScore = score;
        bestProfile = profile;
      }
    }

    if (!bestProfile || bestScore < 0) {
      return {
        ...element,
        semantic_type: element.type,
        text_role: element.kind === 'text' ? 'body' : 'container',
        z_index: element.z_index ?? (element.kind === 'text' ? 20 : 5),
      };
    }

    return {
      ...element,
      semantic_type: bestProfile.target_type,
      text_role: bestProfile.text_role || (element.kind === 'text' ? 'body' : 'container'),
      z_index: bestProfile.z_index ?? element.z_index ?? 10,
      profile_name: bestProfile.name,
    };
  });
}
