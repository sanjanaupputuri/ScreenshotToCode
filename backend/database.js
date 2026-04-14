import sqlite3 from 'sqlite3';
import { promisify } from 'util';

const db = new sqlite3.Database('./database.sqlite');
const dbRun = promisify(db.run.bind(db));
const dbGet = promisify(db.get.bind(db));
const dbAll = promisify(db.all.bind(db));

export async function initializeDatabase() {
  console.log('Initializing database...');
  
  try {
    // Existing tables
    await dbRun(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Users table created');

    await dbRun(`
      CREATE TABLE IF NOT EXISTS generated_codes (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        code TEXT,
        image_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);
    console.log('Generated codes table created');

    // New component system tables
    await dbRun(`
      CREATE TABLE IF NOT EXISTS components (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        category TEXT NOT NULL,
        html_template TEXT NOT NULL,
        css_template TEXT,
        description TEXT
      )
    `);
    console.log('Components table created');

    await dbRun(`
      CREATE TABLE IF NOT EXISTS component_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        component_id INTEGER,
        rule_type TEXT NOT NULL,
        min_value REAL,
        max_value REAL,
        text_condition TEXT,
        color_condition TEXT,
        FOREIGN KEY (component_id) REFERENCES components (id)
      )
    `);
    console.log('Component rules table created');

    await dbRun(`
      CREATE TABLE IF NOT EXISTS colors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hex_value TEXT UNIQUE NOT NULL,
        tailwind_class TEXT NOT NULL,
        category TEXT NOT NULL,
        color_name TEXT NOT NULL
      )
    `);
    console.log('Colors table created');

    await dbRun(`
      CREATE TABLE IF NOT EXISTS spacing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pixel_value INTEGER UNIQUE NOT NULL,
        tailwind_class TEXT NOT NULL,
        rem_value REAL NOT NULL,
        spacing_type TEXT NOT NULL
      )
    `);
    console.log('Spacing table created');

    // Populate with initial data
    await populateInitialData();
    console.log('Database initialization completed successfully');
    
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

async function populateInitialData() {
  try {
    // Check if data already exists
    const componentCount = await dbGet('SELECT COUNT(*) as count FROM components');
    if (componentCount.count > 0) {
      console.log('Data already exists, skipping population');
      return;
    }

    console.log('Populating initial data...');

    // Insert components
    const components = [
      ['button_primary', 'form', '<button class="{{classes}}">{{text}}</button>', '', 'Primary action button'],
      ['input_text', 'form', '<input type="text" class="{{classes}}" placeholder="{{text}}" />', '', 'Text input field'],
      ['heading_h1', 'typography', '<h1 class="{{classes}}">{{text}}</h1>', '', 'Main heading'],
      ['heading_h2', 'typography', '<h2 class="{{classes}}">{{text}}</h2>', '', 'Section heading'],
      ['card_basic', 'layout', '<div class="{{classes}}">{{content}}</div>', '', 'Basic card container'],
      ['nav_link', 'navigation', '<a href="#" class="{{classes}}">{{text}}</a>', '', 'Navigation link'],
      ['image_basic', 'media', '<img src="{{src}}" class="{{classes}}" alt="{{alt}}" />', '', 'Basic image'],
      ['container_div', 'layout', '<div class="{{classes}}">{{content}}</div>', '', 'Generic container']
    ];

    for (const [name, category, html, css, desc] of components) {
      await dbRun(
        'INSERT INTO components (name, category, html_template, css_template, description) VALUES (?, ?, ?, ?, ?)',
        [name, category, html, css, desc]
      );
    }
    console.log(`Inserted ${components.length} components`);

    // Insert component rules
    const rules = [
      // Button rules
      [1, 'aspect_ratio', 2.0, 5.0, 'required', 'bright'],
      [1, 'width', 80, 300, null, null],
      [1, 'height', 30, 60, null, null],
      // Input rules
      [2, 'aspect_ratio', 3.0, 8.0, 'optional', 'neutral'],
      [2, 'width', 100, 400, null, null],
      [2, 'height', 25, 50, null, null],
      // Heading rules
      [3, 'height', 40, 80, 'required', 'any'],
      [4, 'height', 30, 60, 'required', 'any'],
      // Card rules
      [5, 'aspect_ratio', 0.8, 2.0, 'optional', 'any'],
      [5, 'width', 200, 600, null, null],
      [5, 'height', 150, 400, null, null]
    ];

    for (const [compId, type, min, max, text, color] of rules) {
      await dbRun(
        'INSERT INTO component_rules (component_id, rule_type, min_value, max_value, text_condition, color_condition) VALUES (?, ?, ?, ?, ?, ?)',
        [compId, type, min, max, text, color]
      );
    }
    console.log(`Inserted ${rules.length} rules`);

    // Insert colors
    const colors = [
      ['#3B82F6', 'bg-blue-500', 'primary', 'Blue'],
      ['#EF4444', 'bg-red-500', 'danger', 'Red'],
      ['#10B981', 'bg-green-500', 'success', 'Green'],
      ['#F59E0B', 'bg-yellow-500', 'warning', 'Yellow'],
      ['#6B7280', 'bg-gray-500', 'neutral', 'Gray'],
      ['#FFFFFF', 'bg-white', 'neutral', 'White'],
      ['#000000', 'bg-black', 'neutral', 'Black']
    ];

    for (const [hex, tw, cat, name] of colors) {
      await dbRun(
        'INSERT INTO colors (hex_value, tailwind_class, category, color_name) VALUES (?, ?, ?, ?)',
        [hex, tw, cat, name]
      );
    }
    console.log(`Inserted ${colors.length} colors`);

    // Insert spacing
    const spacing = [
      [4, 'p-1', 0.25, 'padding'],
      [8, 'p-2', 0.5, 'padding'],
      [12, 'p-3', 0.75, 'padding'],
      [16, 'p-4', 1.0, 'padding'],
      [24, 'p-6', 1.5, 'padding'],
      [32, 'p-8', 2.0, 'padding']
    ];

    for (const [px, tw, rem, type] of spacing) {
      await dbRun(
        'INSERT INTO spacing (pixel_value, tailwind_class, rem_value, spacing_type) VALUES (?, ?, ?, ?)',
        [px, tw, rem, type]
      );
    }
    console.log(`Inserted ${spacing.length} spacing values`);
    
  } catch (error) {
    console.error('Error populating initial data:', error);
    throw error;
  }
}

// Component classification functions
export async function classifyElement(elementData) {
  const { width, height, hasText, color } = elementData;
  const aspectRatio = width / height;

  const query = `
    SELECT c.id, c.name, c.category, COUNT(*) as score
    FROM components c
    JOIN component_rules cr ON c.id = cr.component_id
    WHERE (cr.rule_type = 'aspect_ratio' AND ? BETWEEN cr.min_value AND cr.max_value)
       OR (cr.rule_type = 'width' AND ? BETWEEN cr.min_value AND cr.max_value)
       OR (cr.rule_type = 'height' AND ? BETWEEN cr.min_value AND cr.max_value)
       OR (cr.text_condition = 'required' AND ? = 1)
       OR (cr.text_condition = 'optional')
    GROUP BY c.id, c.name, c.category
    ORDER BY score DESC
    LIMIT 1
  `;

  return await dbGet(query, [aspectRatio, width, height, hasText ? 1 : 0]);
}

export async function getComponentTemplate(componentId) {
  return await dbGet(
    'SELECT html_template, css_template FROM components WHERE id = ?',
    [componentId]
  );
}

export async function getColorClass(hexColor) {
  return await dbGet(
    'SELECT tailwind_class FROM colors WHERE hex_value = ?',
    [hexColor]
  );
}

export async function getSpacingClass(pixelValue) {
  return await dbGet(
    'SELECT tailwind_class FROM spacing WHERE pixel_value <= ? ORDER BY pixel_value DESC LIMIT 1',
    [pixelValue]
  );
}

// Existing functions
export async function saveUser(uid, email, name) {
  await dbRun(
    'INSERT OR REPLACE INTO users (id, email, name) VALUES (?, ?, ?)',
    [uid, email, name]
  );
}

export async function saveGeneratedCode(userId, code, imageUrl) {
  const id = crypto.randomUUID();
  await dbRun(
    'INSERT INTO generated_codes (id, user_id, code, image_url) VALUES (?, ?, ?, ?)',
    [id, userId, code, imageUrl]
  );
  return { id };
}

export async function getUserHistory(userId) {
  return await dbAll(
    'SELECT * FROM generated_codes WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
}