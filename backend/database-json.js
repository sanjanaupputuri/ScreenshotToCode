import fs from 'fs/promises';
import path from 'path';

const DB_FILE = './database.json';

// Initialize empty database structure
const initDB = {
  users: [],
  generated_codes: [],
  components: [
    { id: 1, name: 'button_primary', category: 'form', html_template: '<button class="{{classes}}">{{text}}</button>', css_template: '', description: 'Primary action button' },
    { id: 2, name: 'input_text', category: 'form', html_template: '<input type="text" class="{{classes}}" placeholder="{{text}}" />', css_template: '', description: 'Text input field' },
    { id: 3, name: 'heading_h1', category: 'typography', html_template: '<h1 class="{{classes}}">{{text}}</h1>', css_template: '', description: 'Main heading' },
    { id: 4, name: 'heading_h2', category: 'typography', html_template: '<h2 class="{{classes}}">{{text}}</h2>', css_template: '', description: 'Section heading' },
    { id: 5, name: 'card_basic', category: 'layout', html_template: '<div class="{{classes}}">{{content}}</div>', css_template: '', description: 'Basic card container' }
  ],
  component_rules: [
    { id: 1, component_id: 1, rule_type: 'aspect_ratio', min_value: 2.0, max_value: 5.0, text_condition: 'required', color_condition: 'bright' },
    { id: 2, component_id: 1, rule_type: 'width', min_value: 80, max_value: 300, text_condition: null, color_condition: null },
    { id: 3, component_id: 1, rule_type: 'height', min_value: 30, max_value: 60, text_condition: null, color_condition: null },
    { id: 4, component_id: 2, rule_type: 'aspect_ratio', min_value: 3.0, max_value: 8.0, text_condition: 'optional', color_condition: 'neutral' },
    { id: 5, component_id: 2, rule_type: 'width', min_value: 100, max_value: 400, text_condition: null, color_condition: null },
    { id: 6, component_id: 3, rule_type: 'height', min_value: 40, max_value: 80, text_condition: 'required', color_condition: 'any' },
    { id: 7, component_id: 5, rule_type: 'aspect_ratio', min_value: 0.8, max_value: 2.0, text_condition: 'optional', color_condition: 'any' }
  ],
  colors: [
    { id: 1, hex_value: '#3B82F6', tailwind_class: 'bg-blue-500', category: 'primary', color_name: 'Blue' },
    { id: 2, hex_value: '#EF4444', tailwind_class: 'bg-red-500', category: 'danger', color_name: 'Red' },
    { id: 3, hex_value: '#10B981', tailwind_class: 'bg-green-500', category: 'success', color_name: 'Green' },
    { id: 4, hex_value: '#FFFFFF', tailwind_class: 'bg-white', category: 'neutral', color_name: 'White' },
    { id: 5, hex_value: '#000000', tailwind_class: 'bg-black', category: 'neutral', color_name: 'Black' }
  ],
  spacing: [
    { id: 1, pixel_value: 4, tailwind_class: 'p-1', rem_value: 0.25, spacing_type: 'padding' },
    { id: 2, pixel_value: 8, tailwind_class: 'p-2', rem_value: 0.5, spacing_type: 'padding' },
    { id: 3, pixel_value: 16, tailwind_class: 'p-4', rem_value: 1.0, spacing_type: 'padding' },
    { id: 4, pixel_value: 24, tailwind_class: 'p-6', rem_value: 1.5, spacing_type: 'padding' }
  ]
};

async function loadDB() {
  try {
    const data = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return initDB;
  }
}

async function saveDB(data) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

export async function initializeDatabase() {
  console.log('Initializing JSON database...');
  const db = await loadDB();
  await saveDB(db);
  console.log('Database initialized successfully');
}

export async function classifyElement(elementData) {
  const db = await loadDB();
  const { width, height, hasText } = elementData;
  const aspectRatio = width / height;

  let bestMatch = null;
  let bestScore = 0;

  for (const component of db.components) {
    const rules = db.component_rules.filter(r => r.component_id === component.id);
    let score = 0;

    for (const rule of rules) {
      if (rule.rule_type === 'aspect_ratio' && aspectRatio >= rule.min_value && aspectRatio <= rule.max_value) {
        score++;
      }
      if (rule.rule_type === 'width' && width >= rule.min_value && width <= rule.max_value) {
        score++;
      }
      if (rule.rule_type === 'height' && height >= rule.min_value && height <= rule.max_value) {
        score++;
      }
      if (rule.text_condition === 'required' && hasText) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { ...component, score };
    }
  }

  return bestMatch;
}

export async function getComponentTemplate(componentId) {
  const db = await loadDB();
  return db.components.find(c => c.id === componentId);
}

export async function getColorClass(hexColor) {
  const db = await loadDB();
  return db.colors.find(c => c.hex_value === hexColor);
}

export async function getSpacingClass(pixelValue) {
  const db = await loadDB();
  return db.spacing
    .filter(s => s.pixel_value <= pixelValue)
    .sort((a, b) => b.pixel_value - a.pixel_value)[0];
}

export async function saveUser(uid, email, name) {
  const db = await loadDB();
  const existingIndex = db.users.findIndex(u => u.id === uid);
  
  if (existingIndex >= 0) {
    db.users[existingIndex] = { id: uid, email, name, created_at: new Date().toISOString() };
  } else {
    db.users.push({ id: uid, email, name, created_at: new Date().toISOString() });
  }
  
  await saveDB(db);
}

export async function saveGeneratedCode(userId, code, imageUrl) {
  const db = await loadDB();
  const id = crypto.randomUUID();
  
  db.generated_codes.push({
    id,
    user_id: userId,
    code,
    image_url: imageUrl,
    created_at: new Date().toISOString()
  });
  
  await saveDB(db);
  return { id };
}

export async function getUserHistory(userId) {
  const db = await loadDB();
  return db.generated_codes
    .filter(gc => gc.user_id === userId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}