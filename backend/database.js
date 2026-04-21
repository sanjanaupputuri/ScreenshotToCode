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
        UNIQUE(component_id, rule_type, min_value, max_value),
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

      CREATE TABLE IF NOT EXISTS page_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        page_kind TEXT UNIQUE NOT NULL,
        html_scaffold TEXT NOT NULL,
        css_scaffold TEXT NOT NULL,
        description TEXT
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
        border_radius_tier TEXT DEFAULT 'any',
        z_index INTEGER DEFAULT 10,
        priority INTEGER DEFAULT 1,
        text_role TEXT,
        description TEXT
      );
    `);

    // Stage 2 templates: add optional HTML/CSS templates to primitive profiles (migration-safe).
    const cols = await all('PRAGMA table_info(primitive_profiles)');
    const names = new Set(cols.map((c) => c.name));
    const ensure = async (name, spec) => {
      if (!names.has(name)) {
        await exec(`ALTER TABLE primitive_profiles ADD COLUMN ${name} ${spec}`);
        names.add(name);
      }
    };
    await ensure('min_aspect', 'REAL');
    await ensure('max_aspect', 'REAL');
    await ensure('min_width', 'REAL');
    await ensure('max_width', 'REAL');
    await ensure('min_height', 'REAL');
    await ensure('max_height', 'REAL');
    await ensure('text_pattern', 'TEXT');
    await ensure('fill_mode', 'TEXT');
    await ensure('border_radius_tier', "TEXT DEFAULT 'any'");
    await ensure('z_index', 'INTEGER DEFAULT 10');
    await ensure('priority', 'INTEGER DEFAULT 1');
    await ensure('text_role', 'TEXT');
    await ensure('description', 'TEXT');
    await ensure('html_template', 'TEXT');
    await ensure('css_template', 'TEXT');

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
  const missingProfileTemplates = (await get('SELECT COUNT(*) as c FROM primitive_profiles WHERE html_template IS NULL'))?.c ?? 0;

  // Always run to insert new profiles/colors/spacing added in updates (INSERT OR IGNORE is safe)
  const needsFullInit = componentCount === 0 || primitiveProfileCount === 0 || colorCount === 0 || spacingCount === 0;
  const needsTemplateUpdate = missingProfileTemplates > 0;
  // Check if new profiles from the expanded library are missing
  const hasNewProfiles = (await get("SELECT COUNT(*) as c FROM primitive_profiles WHERE name IN ('cta_button','sticky_navbar','feature_card','sidebar_panel','hero_section','footer_panel','active_filter_pill','toggle_switch_on','tab_bar')"))?.c ?? 0;
  const needsNewProfiles = hasNewProfiles < 9;

  if (!needsFullInit && !needsTemplateUpdate && !needsNewProfiles) return;

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
    // Extended palette for better color reproduction
    ['#0969da', 'bg-blue-600 text-white', 'primary', 'GitHub Blue'],
    ['#1f883d', 'bg-green-700 text-white', 'success', 'GitHub Green'],
    ['#cf222e', 'bg-red-700 text-white', 'danger', 'GitHub Red'],
    ['#9a6700', 'bg-yellow-700 text-white', 'warning', 'GitHub Yellow'],
    ['#6e40c9', 'bg-purple-600 text-white', 'accent', 'Purple'],
    ['#0891b2', 'bg-cyan-600 text-white', 'primary', 'Cyan'],
    ['#f97316', 'bg-orange-500 text-white', 'warning', 'Orange'],
    ['#ec4899', 'bg-pink-500 text-white', 'accent', 'Pink'],
    ['#14b8a6', 'bg-teal-500 text-white', 'success', 'Teal'],
    ['#8b5cf6', 'bg-violet-500 text-white', 'accent', 'Violet'],
    ['#f1f5f9', 'bg-slate-100', 'neutral', 'Slate 100'],
    ['#e2e8f0', 'bg-slate-200', 'neutral', 'Slate 200'],
    ['#94a3b8', 'bg-slate-400', 'neutral', 'Slate 400'],
    ['#475569', 'bg-slate-600 text-white', 'neutral', 'Slate 600'],
    ['#1e293b', 'bg-slate-800 text-white', 'neutral', 'Slate 800'],
    ['#0f172a', 'bg-slate-900 text-white', 'neutral', 'Slate 900'],
    ['#f6f8fa', 'bg-gray-50', 'neutral', 'GitHub Surface'],
    ['#24292f', 'bg-gray-900 text-white', 'neutral', 'GitHub Dark'],
    ['#161b22', 'bg-gray-950 text-white', 'neutral', 'GitHub Darker'],
    ['#30363d', 'bg-gray-800 text-white', 'neutral', 'GitHub Border Dark'],
    ['#d0d7de', 'border-gray-300', 'neutral', 'GitHub Border Light'],
  ];

  const spacing = [
    [2, 'p-0.5', 0.125, 'padding'], [4, 'p-1', 0.25, 'padding'],
    [6, 'p-1.5', 0.375, 'padding'], [8, 'p-2', 0.5, 'padding'],
    [10, 'p-2.5', 0.625, 'padding'], [12, 'p-3', 0.75, 'padding'],
    [14, 'p-3.5', 0.875, 'padding'], [16, 'p-4', 1.0, 'padding'],
    [20, 'p-5', 1.25, 'padding'], [24, 'p-6', 1.5, 'padding'],
    [28, 'p-7', 1.75, 'padding'], [32, 'p-8', 2.0, 'padding'],
    [36, 'p-9', 2.25, 'padding'], [40, 'p-10', 2.5, 'padding'],
    [48, 'p-12', 3.0, 'padding'], [56, 'p-14', 3.5, 'padding'],
    [64, 'p-16', 4.0, 'padding'], [80, 'p-20', 5.0, 'padding'],
    [96, 'p-24', 6.0, 'padding'],
    // gap values
    [4, 'gap-1', 0.25, 'gap'], [8, 'gap-2', 0.5, 'gap'],
    [12, 'gap-3', 0.75, 'gap'], [16, 'gap-4', 1.0, 'gap'],
    [20, 'gap-5', 1.25, 'gap'], [24, 'gap-6', 1.5, 'gap'],
    [32, 'gap-8', 2.0, 'gap'], [40, 'gap-10', 2.5, 'gap'],
    [48, 'gap-12', 3.0, 'gap'],
  ];

  const primitiveProfiles = [
    // shape profiles — [name, base_kind, target_type, min_aspect, max_aspect, min_w, max_w, min_h, max_h, text_pattern, fill_mode, border_radius_tier, z_index, priority, text_role, description]
    ['page_toolbar',      'shape', 'toolbar', 4.0, 80.0, 300, 5000, 24, 96,  null, 'filled',   'none',   4, 9, 'chrome',    'Top browser or app toolbar'],
    ['sticky_navbar',     'shape', 'toolbar', 5.0, 80.0, 400, 5000, 48, 80,  null, 'any',      'none',   4, 9, 'chrome',    'Sticky navigation bar'],
    ['toggle_switch_on',  'shape', 'toggle',  1.5, 3.0,  28,  80,   14, 32,  null, 'filled',   'full',   11, 10, 'toggle',   'Toggle switch (on state)'],
    ['toggle_switch_off', 'shape', 'toggle',  1.5, 3.0,  28,  80,   14, 32,  null, 'outlined', 'full',   11, 9, 'toggle',   'Toggle switch (off state)'],
    ['filled_button',     'shape', 'button',  2.2, 12.0, 50,  420,  28, 72,  null, 'filled',   'small',  12, 8, 'action',   'Filled primary action button'],
    ['outline_button',    'shape', 'button',  2.2, 12.0, 50,  420,  28, 72,  null, 'outlined', 'small',  12, 7, 'action',   'Secondary outlined button'],
    ['ghost_button',      'shape', 'button',  2.2, 12.0, 50,  420,  28, 72,  null, 'any',      'none',   11, 6, 'action',   'Ghost/text-only button'],
    ['pill_button',       'shape', 'button',  2.2, 12.0, 50,  420,  28, 72,  null, 'filled',   'full',   12, 8, 'action',   'Pill-shaped CTA button'],
    ['cta_button',        'shape', 'button',  2.0, 8.0,  80,  360,  40, 80,  '(get started|sign up|try|learn more|start|join|subscribe|download|buy|shop)', 'filled', 'medium', 12, 9, 'cta', 'CTA button with subtitle'],
    ['icon_button',       'shape', 'button',  0.7, 1.3,  20,  60,   20, 60,  null, 'any',      'any',    12, 7, 'icon',     'Square icon-only button'],
    ['border_input',      'shape', 'input',   2.5, 24.0, 80,  1200, 20, 72,  null, 'outlined', 'small',  11, 8, 'field',    'Outlined input field'],
    ['search_input',      'shape', 'input',   3.0, 30.0, 120, 1200, 28, 60,  '(search|find|query)', 'outlined', 'small', 11, 9, 'field', 'Search input with icon'],
    ['search_input_icon', 'shape', 'input',   3.0, 30.0, 120, 1200, 28, 60,  null, 'outlined', 'medium', 11, 8, 'field',    'Search input with icon inside'],
    ['tab_chip',          'shape', 'chip',    1.5, 12.0, 24,  400,  16, 56,  null, 'outlined', 'medium', 10, 7, 'tab',      'Tab, filter, or chip'],
    ['pill_chip',         'shape', 'chip',    1.5, 12.0, 24,  400,  16, 40,  null, 'any',      'full',   10, 7, 'badge',    'Pill badge or label'],
    ['active_filter_pill','shape', 'chip',    1.5, 10.0, 24,  300,  16, 40,  null, 'filled',   'full',   10, 8, 'filter',   'Active filter pill (filled)'],
    ['inactive_filter_pill','shape','chip',   1.5, 10.0, 24,  300,  16, 40,  null, 'outlined', 'full',   10, 7, 'filter',   'Inactive filter pill (outlined)'],
    ['select_dropdown',   'shape', 'select',  1.5, 10.0, 40,  400,  18, 48,  null, 'any',      'small',  11, 8, 'select',   'Dropdown selector'],
    ['tab_bar',           'shape', 'toolbar', 3.0, 80.0, 200, 5000, 36, 60,  '(home|explore|search|profile|settings|feed|notifications)', 'any', 'none', 5, 8, 'tab-bar', 'Tab bar navigation'],
    ['icon_glyph',        'shape', 'icon',    0.65,1.35, 8,   80,   8,  80,  null, 'any',      'any',    14, 8, 'icon',     'Icon glyph or badge'],
    ['avatar_circle',     'shape', 'avatar',  0.75,1.25, 20,  140,  20, 140, null, 'any',      'full',   15, 8, 'avatar',   'Avatar or circular marker'],
    ['card_container',    'shape', 'card',    0.5, 3.0,  100, 2000, 80, 1200,null, 'any',      'small',  6,  6, 'card',     'Card with multiple children'],
    ['feature_card',      'shape', 'card',    0.6, 2.0,  160, 600,  120, 400,null, 'any',      'medium', 6,  7, 'card',     'Feature card (icon+title+desc)'],
    ['panel_container',   'shape', 'panel',   0.4, 50.0, 40,  5000, 24, 3000,null, 'any',      'any',    6,  5, 'container','Layout container'],
    ['sidebar_panel',     'shape', 'panel',   0.1, 0.6,  120, 400,  200, 3000,null,'any',      'none',   4,  7, 'sidebar',  'Sidebar panel'],
    ['hero_section',      'shape', 'panel',   2.0, 20.0, 400, 5000, 200, 800,null, 'any',      'none',   3,  6, 'hero',     'Hero/banner section'],
    ['footer_panel',      'shape', 'panel',   3.0, 80.0, 400, 5000, 60, 400, null, 'any',      'none',   3,  6, 'footer',   'Footer with columns'],
    ['divider_line',      'shape', 'divider', 5.0, 9999, 100, 9999, 1,  4,   null, 'any',      'none',   2,  9, 'divider',  'Horizontal divider line'],
    // text profiles
    ['display_heading',   'text', 'display_heading', 1.0, 40.0, 80, 2400, 48, 200, null, 'any', 'any', 30, 10, 'display',  'Large display heading'],
    ['repo_title',        'text', 'title',    1.8, 40.0, 80,  2400, 18, 120, '(repo|firetruck|readme|issues|pull|actions|projects|insights|settings)', 'any', 'any', 30, 10, 'title', 'Repository heading'],
    ['section_heading',   'text', 'heading',  1.0, 40.0, 60,  2400, 24, 80,  null, 'any', 'any', 28, 8, 'heading',  'Section heading'],
    ['subheading',        'text', 'subheading',1.0,40.0, 40,  2400, 16, 40,  null, 'any', 'any', 25, 7, 'subheading','Subheading or subtitle'],
    ['nav_text',          'text', 'nav_text', 1.0, 40.0, 10,  1200, 10, 48,  '(code|issues|wiki|pull|actions|projects|security|settings|fork|star|watch)', 'any', 'any', 24, 8, 'nav', 'Navigation text'],
    ['badge_label',       'text', 'badge',    1.0, 10.0, 20,  200,  10, 28,  null, 'any', 'any', 22, 8, 'badge',    'Badge or label text'],
    ['inline_link',       'text', 'link',     1.0, 40.0, 20,  800,  10, 28,  null, 'any', 'any', 22, 7, 'link',     'Inline link text'],
    ['caption_text',      'text', 'caption',  1.0, 60.0, 8,   1400, 8,  22,  null, 'any', 'any', 20, 6, 'caption',  'Caption or small label'],
    ['muted_label',       'text', 'muted_text',1.0,60.0, 8,   1400, 8,  40,  '(public|commits|activity|releases|packages|published|create|upload|minute|ago)', 'any', 'any', 22, 7, 'muted', 'Secondary label text'],
    ['body_copy',         'text', 'body_text', 1.0,80.0, 8,   2400, 8,  52,  null, 'any', 'any', 20, 3, 'body',     'General body copy'],
  ];

  const primitiveProfileTemplates = [
    ['filled_button', '<button type="button" style="{{style}}">{{text}}</button>', null],
    ['outline_button', '<button type="button" style="{{style}}">{{text}}</button>', null],
    ['ghost_button', '<button type="button" style="{{style}}">{{text}}</button>', null],
    ['pill_button', '<button type="button" style="{{style}}">{{text}}</button>', null],
    ['cta_button', '<button type="button" style="{{style}}">{{text}}</button>', null],
    ['icon_button', '<button type="button" style="{{style}}" aria-label="{{text}}"></button>', null],
    ['border_input', '<input type="text" placeholder="{{text}}" readonly style="{{style}}" />', null],
    ['search_input', '<input type="search" placeholder="{{text}}" readonly style="{{style}}" />', null],
    ['search_input_icon', '<input type="search" placeholder="{{text}}" readonly style="{{style}}" />', null],
    ['select_dropdown', '<select style="{{style}}"><option>{{text}}</option></select>', null],
    ['tab_chip', '<div style="{{style}}">{{text}}</div>', null],
    ['pill_chip', '<div style="{{style}}">{{text}}</div>', null],
    ['active_filter_pill', '<button type="button" style="{{style}}">{{text}}</button>', null],
    ['inactive_filter_pill', '<button type="button" style="{{style}}">{{text}}</button>', null],
    ['toggle_switch_on', '<button type="button" style="{{style}}" aria-pressed="true"></button>', null],
    ['toggle_switch_off', '<button type="button" style="{{style}}" aria-pressed="false"></button>', null],
    ['tab_bar', '<nav style="{{style}}">{{content}}</nav>', null],
    ['divider_line', '<div style="{{style}}"></div>', null],
    ['card_container', '<div style="{{style}}">{{content}}</div>', null],
    ['feature_card', '<div style="{{style}}">{{content}}</div>', null],
    ['panel_container', '<div style="{{style}}">{{content}}</div>', null],
    ['sidebar_panel', '<aside style="{{style}}">{{content}}</aside>', null],
    ['hero_section', '<section style="{{style}}">{{content}}</section>', null],
    ['footer_panel', '<footer style="{{style}}">{{content}}</footer>', null],
    ['icon_glyph', '<div style="{{style}}" aria-hidden="true"></div>', null],
    ['avatar_circle', '<div style="{{style}}" aria-hidden="true"></div>', null],
    ['sticky_navbar', '<nav style="{{style}}">{{content}}</nav>', null],
    ['display_heading', '<div style="{{style}}">{{text}}</div>', null],
    ['repo_title', '<div style="{{style}}">{{text}}</div>', null],
    ['section_heading', '<div style="{{style}}">{{text}}</div>', null],
    ['subheading', '<div style="{{style}}">{{text}}</div>', null],
    ['nav_text', '<div style="{{style}}">{{text}}</div>', null],
    ['badge_label', '<div style="{{style}}">{{text}}</div>', null],
    ['inline_link', '<a href=\"#\" style=\"{{style}}\">{{text}}</a>', null],
    ['caption_text', '<div style="{{style}}">{{text}}</div>', null],
    ['muted_label', '<div style="{{style}}">{{text}}</div>', null],
    ['body_copy', '<div style="{{style}}">{{text}}</div>', null],
  ];

  // T12: Add 2-col split, 3-col grid, form page templates
  const extraTemplates = [
    ['two-col-split', `<nav style="background:{{navBg}};display:flex;align-items:center;padding:0 2rem;height:60px;gap:1rem;border-bottom:1px solid rgba(128,128,128,0.15);">{{navContent}}</nav>
<main style="display:grid;grid-template-columns:1fr 1fr;min-height:calc(100vh - 60px);">
  <section style="padding:3rem 2rem;">{{leftContent}}</section>
  <section style="padding:3rem 2rem;background:{{surfaceBg}};">{{rightContent}}</section>
</main>`,
    `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:{{bg}};color:{{textColor}};min-height:100vh;}
button{cursor:pointer;transition:opacity 0.15s,transform 0.1s;}
button:hover{opacity:0.9;transform:translateY(-1px);}
input:focus{outline:2px solid {{accentColor}};box-shadow:0 0 0 3px {{accentColor}}33;}`,
    'Two-column split layout'],

    ['three-col-grid', `<nav style="background:{{navBg}};display:flex;align-items:center;padding:0 2rem;height:60px;gap:1rem;border-bottom:1px solid rgba(128,128,128,0.15);">{{navContent}}</nav>
<main style="padding:2rem;max-width:1280px;margin:0 auto;">
  {{heroSection}}
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.5rem;margin-top:2rem;">{{gridItems}}</div>
</main>
{{footerSection}}`,
    `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:{{bg}};color:{{textColor}};min-height:100vh;}
.card{background:{{surfaceBg}};border:1px solid {{borderColor}};border-radius:8px;padding:1.5rem;transition:box-shadow 0.2s;}
.card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.1);}
button{cursor:pointer;transition:opacity 0.15s;}
button:hover{opacity:0.9;}`,
    'Three-column grid layout'],

    ['form', `<nav style="background:{{navBg}};display:flex;align-items:center;padding:0 2rem;height:60px;gap:1rem;border-bottom:1px solid rgba(128,128,128,0.15);">{{navContent}}</nav>
<main style="display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 60px);padding:2rem;">
  <form style="background:{{surfaceBg}};border:1px solid {{borderColor}};border-radius:12px;padding:2.5rem;width:100%;max-width:480px;display:flex;flex-direction:column;gap:1.25rem;">
    {{formContent}}
  </form>
</main>`,
    `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:{{bg}};color:{{textColor}};min-height:100vh;}
label{display:flex;flex-direction:column;gap:4px;font-size:14px;font-weight:500;}
input,select,textarea{border:1px solid {{borderColor}};border-radius:6px;padding:8px 12px;font-size:14px;background:{{bg}};color:{{textColor}};outline:none;}
input:focus,select:focus,textarea:focus{border-color:{{accentColor}};box-shadow:0 0 0 3px {{accentColor}}33;}
button[type=submit]{background:{{accentColor}};color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity 0.15s;}
button[type=submit]:hover{opacity:0.9;}`,
    'Form/auth page'],
  ];

  const pageTemplates = [
    ['landing', `<nav style="background:{{navBg}};display:flex;align-items:center;padding:0 2rem;height:64px;gap:1rem;border-bottom:1px solid rgba(128,128,128,0.15);">{{navContent}}</nav>
<main>{{heroSection}}{{contentSection}}</main>
{{footerSection}}`,
    `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:{{bg}};color:{{textColor}};min-height:100vh;}
nav a{color:{{mutedColor}};text-decoration:none;font-size:14px;font-weight:500;padding:6px 12px;border-radius:6px;transition:color 0.15s;}
nav a:hover{color:{{textColor}};background:rgba(128,128,128,0.1);}
button{cursor:pointer;transition:opacity 0.15s,transform 0.1s;}
button:hover{opacity:0.9;}
button:active{transform:scale(0.97);}
input:focus{outline:2px solid {{accentColor}};box-shadow:0 0 0 3px {{accentColor}}33;}`,
    'Marketing/product landing page'],

    ['repository', `<nav style="background:{{navBg}};display:flex;align-items:center;padding:0 1rem;height:56px;gap:1rem;border-bottom:1px solid rgba(128,128,128,0.2);">{{navContent}}</nav>
<div style="background:{{tabBg}};border-bottom:1px solid #d0d7de;display:flex;padding:0 1rem;gap:0.25rem;">{{tabContent}}</div>
<div style="max-width:1280px;margin:0 auto;padding:1rem;">{{repoHeader}}</div>
<div style="max-width:1280px;margin:0 auto;padding:0 1rem 2rem;display:grid;grid-template-columns:1fr 296px;gap:1.5rem;">{{mainContent}}{{sidebarContent}}</div>`,
    `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;background:{{bg}};color:{{textColor}};min-height:100vh;}
a{color:{{accentColor}};text-decoration:none;}
a:hover{text-decoration:underline;}
button{cursor:pointer;transition:opacity 0.15s;}
button:hover{opacity:0.9;}
.tab{display:flex;align-items:center;gap:6px;padding:10px 12px;font-size:13px;font-weight:500;color:{{mutedColor}};border-bottom:2px solid transparent;text-decoration:none;}
.tab:hover{color:{{textColor}};background:rgba(128,128,128,0.05);}
.tab.active{color:{{textColor}};border-bottom-color:{{accentColor}};}
.btn{display:flex;align-items:center;gap:5px;padding:5px 12px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;font-size:12px;font-weight:500;cursor:pointer;}
.btn:hover{background:#f3f4f6;}`,
    'GitHub/GitLab repository page'],

    ['dashboard', `<nav style="background:{{navBg}};display:flex;align-items:center;padding:0 1.5rem;height:60px;gap:1rem;border-bottom:1px solid rgba(128,128,128,0.2);">{{navContent}}</nav>
<div style="display:flex;min-height:calc(100vh - 60px);">
<aside style="width:240px;background:{{sidebarBg}};border-right:1px solid rgba(128,128,128,0.15);padding:1rem 0.75rem;">{{sidebarContent}}</aside>
<main style="flex:1;padding:1.5rem;">{{mainContent}}</main>
</div>`,
    `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:{{bg}};color:{{textColor}};min-height:100vh;}
button{cursor:pointer;transition:opacity 0.15s;}
button:hover{opacity:0.9;}`,
    'Analytics/admin dashboard'],

    ['generic', `<nav style="background:{{navBg}};display:flex;align-items:center;padding:0 2rem;height:60px;gap:1rem;">{{navContent}}</nav>
<main style="padding:2rem;">{{mainContent}}</main>`,
    `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:{{bg}};color:{{textColor}};min-height:100vh;}
button{cursor:pointer;transition:opacity 0.15s;}
button:hover{opacity:0.9;}`,
    'Generic page'],
  ];

  const pageTemplateCount = (await get('SELECT COUNT(*) as c FROM page_templates'))?.c ?? 0;
  if (pageTemplateCount === 0) {
    for (const [kind, html, css, desc] of [...pageTemplates, ...extraTemplates]) {
      await run(
        'INSERT OR IGNORE INTO page_templates (page_kind, html_scaffold, css_scaffold, description) VALUES (?, ?, ?, ?)',
        [kind, html, css, desc],
      );
    }
  }

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
          'INSERT OR IGNORE INTO component_rules (component_id, rule_type, min_value, max_value, text_condition, color_condition) VALUES (?, ?, ?, ?, ?, ?)',
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
        (name, base_kind, target_type, min_aspect, max_aspect, min_width, max_width, min_height, max_height, text_pattern, fill_mode, border_radius_tier, z_index, priority, text_role, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        profile,
      );
    }

    for (const [name, htmlTemplate, cssTemplate] of primitiveProfileTemplates) {
      await run(
        'UPDATE primitive_profiles SET html_template = COALESCE(html_template, ?), css_template = COALESCE(css_template, ?) WHERE name = ?',
        [htmlTemplate, cssTemplate, name],
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

function borderRadiusTierForElement(element) {
  const r = Number(element.border_radius) || 0;
  const h = Number(element.height) || 1;
  const ratio = r / h;
  if (ratio >= 0.45) return 'full';
  if (ratio >= 0.15) return 'medium';
  if (r >= 2) return 'small';
  return 'none';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rangeScore(value, minValue, maxValue, inRangePoints = 2, outOfRangePenalty = 1) {
  if (minValue === null && maxValue === null) return 0;
  const min = minValue === null ? -Infinity : Number(minValue);
  const max = maxValue === null ? Infinity : Number(maxValue);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return -outOfRangePenalty;

  if (numeric >= min && numeric <= max) return inRangePoints;

  const span = Math.max(1e-6, max - min);
  const nearest = clamp(numeric, min, max);
  const normalizedDistance = Math.abs(numeric - nearest) / span;
  return -outOfRangePenalty - (normalizedDistance * outOfRangePenalty);
}

function scoreProfileMatch(element, profile) {
  const aspect = (Number(element.width) || 1) / Math.max(Number(element.height) || 1, 1);
  const width = Number(element.width) || 0;
  const height = Number(element.height) || 0;
  const text = element.text || '';
  let score = 0;

  if (profile.base_kind !== (element.kind || 'shape')) return -Infinity;

  // Soft-score ranges (Stage 2 template scoring). Hard filtering causes overconfident matches; we instead
  // require a minimum score threshold downstream and can fall back to `semantic_type: "unknown"`.
  score += rangeScore(aspect, profile.min_aspect, profile.max_aspect, 2, 1);
  score += rangeScore(width, profile.min_width, profile.max_width, 2, 1);
  score += rangeScore(height, profile.min_height, profile.max_height, 2, 1);

  const fillMode = fillModeForElement(element);
  if (profile.fill_mode && profile.fill_mode !== 'any') {
    score += (profile.fill_mode === fillMode) ? 1.25 : -1.75;
  }

  if (profile.text_pattern) {
    score += textMatchesPattern(text, profile.text_pattern) ? 2.25 : -2.25;
  }

  // T9: Border radius tier scoring
  const elTier = borderRadiusTierForElement(element);
  const profTier = profile.border_radius_tier || 'any';
  if (profTier !== 'any') {
    score += (profTier === elTier) ? 2.0 : -1.5;
  }

  score += (Number(profile.priority) || 1) * 0.35;

  const rawType = element.type || '';
  const profileType = profile.target_type || '';
  if (rawType && profileType) {
    if (rawType === profileType) score += 2.0;
    else if (rawType !== 'shape' && rawType !== 'text') score -= 1.0;
  }

  if (text && element.kind === 'text') score += Math.min(1.25, Math.max(0, text.length / 40));
  return score;
}

export async function enrichDetectedElements(elements = []) {
  await initializeDatabase();
  const profiles = await all('SELECT * FROM primitive_profiles ORDER BY priority DESC, id ASC');
  const baseThreshold = Number(process.env.PROFILE_MATCH_THRESHOLD || 4.5);
  const thresholdFor = (element) => {
    if ((element.kind || 'shape') === 'text') return Math.max(3.0, baseThreshold - 1.0);
    return baseThreshold;
  };

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

    const acceptThreshold = thresholdFor(element);
    const acceptMatch = bestProfile && Number.isFinite(bestScore) && bestScore >= acceptThreshold;

    if (!acceptMatch) {
      const rawType = element.type || (element.kind === 'text' ? 'text' : 'shape');
      const shouldForceUnknown = (element.kind === 'shape' && (rawType === 'shape' || !rawType));
      return {
        ...element,
        semantic_type: shouldForceUnknown ? 'unknown' : rawType,
        text_role: element.kind === 'text' ? 'body' : 'container',
        z_index: element.z_index ?? (element.kind === 'text' ? 20 : 5),
        profile_name: null,
        profile_score: bestScore,
      };
    }

    // Allow shape→button/chip/input upgrade when the profile score is strong (≥7.0).
    // A weak match keeps the raw type to avoid false positives.
    const rawType = element.type;
    const profileType = bestProfile.target_type;
    const isControlUpgrade = rawType === 'shape' && ['button', 'chip', 'input'].includes(profileType);
    const upgradeAllowed = !isControlUpgrade || bestScore >= 7.0;

    return {
      ...element,
      semantic_type: upgradeAllowed ? profileType : rawType,
      text_role: bestProfile.text_role || (element.kind === 'text' ? 'body' : 'container'),
      z_index: bestProfile.z_index ?? element.z_index ?? 10,
      profile_name: bestProfile.name,
      profile_score: bestScore,
      template_html: bestProfile.html_template || null,
      template_css: bestProfile.css_template || null,
    };
  });
}


export async function getPageTemplate(pageKind) {
  await initializeDatabase();
  const row = await get('SELECT * FROM page_templates WHERE page_kind = ?', [pageKind])
    || await get('SELECT * FROM page_templates WHERE page_kind = ?', ['generic']);
  return row || null;
}
