import { initializeDatabase, classifyElement, getComponentTemplate } from './database.js';

// Database management utility
export class DatabaseManager {
  
  static async viewComponents() {
    const sqlite3 = (await import('sqlite3')).default;
    const db = new sqlite3.Database('./database.sqlite');
    
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM components', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  static async viewRules() {
    const sqlite3 = (await import('sqlite3')).default;
    const db = new sqlite3.Database('./database.sqlite');
    
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT cr.*, c.name as component_name 
        FROM component_rules cr 
        JOIN components c ON cr.component_id = c.id
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  static async viewColors() {
    const sqlite3 = (await import('sqlite3')).default;
    const db = new sqlite3.Database('./database.sqlite');
    
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM colors', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  static async testClassification() {
    // Test element classification with sample data
    const testElements = [
      { width: 150, height: 40, hasText: true, color: '#3B82F6' }, // Should be button
      { width: 300, height: 35, hasText: true, color: '#FFFFFF' }, // Should be input
      { width: 400, height: 50, hasText: true, color: '#000000' }, // Should be heading
      { width: 250, height: 200, hasText: false, color: '#F3F4F6' } // Should be card
    ];

    const results = [];
    
    for (const element of testElements) {
      const classification = await classifyElement(element);
      const template = classification ? await getComponentTemplate(classification.id) : null;
      
      results.push({
        element,
        classification,
        template: template?.html_template
      });
    }

    return results;
  }

  static async resetDatabase() {
    const sqlite3 = (await import('sqlite3')).default;
    const db = new sqlite3.Database('./database.sqlite');
    
    const tables = ['components', 'component_rules', 'colors', 'spacing'];
    
    for (const table of tables) {
      await new Promise((resolve, reject) => {
        db.run(`DELETE FROM ${table}`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Reinitialize with fresh data
    await initializeDatabase();
    
    return 'Database reset successfully';
  }
}

// CLI interface for database management
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  switch (command) {
    case 'init':
      await initializeDatabase();
      console.log('Database initialized');
      break;
      
    case 'components':
      const components = await DatabaseManager.viewComponents();
      console.table(components);
      break;
      
    case 'rules':
      const rules = await DatabaseManager.viewRules();
      console.table(rules);
      break;
      
    case 'colors':
      const colors = await DatabaseManager.viewColors();
      console.table(colors);
      break;
      
    case 'test':
      const testResults = await DatabaseManager.testClassification();
      console.log('Classification Test Results:');
      testResults.forEach((result, i) => {
        console.log(`\nTest ${i + 1}:`);
        console.log('Element:', result.element);
        console.log('Classification:', result.classification);
        console.log('Template:', result.template);
      });
      break;
      
    case 'reset':
      const resetResult = await DatabaseManager.resetDatabase();
      console.log(resetResult);
      break;
      
    default:
      console.log('Available commands:');
      console.log('  init      - Initialize database');
      console.log('  components - View all components');
      console.log('  rules     - View all classification rules');
      console.log('  colors    - View all colors');
      console.log('  test      - Test classification system');
      console.log('  reset     - Reset database');
  }
  
  process.exit(0);
}