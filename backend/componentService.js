import { classifyElement, getComponentTemplate, getColorClass, getSpacingClass } from './database-json.js';

export class ComponentService {
  
  static async processElement(elementData) {
    try {
      // Classify the element based on its properties
      const classification = await classifyElement(elementData);
      
      if (!classification) {
        return this.createFallbackComponent(elementData);
      }

      // Get the template for this component
      const template = await getComponentTemplate(classification.id);
      
      if (!template) {
        return this.createFallbackComponent(elementData);
      }

      // Generate styling classes
      const classes = await this.generateClasses(elementData);
      
      // Substitute placeholders in template
      const html = this.substituteTemplate(template.html_template, {
        classes: classes.join(' '),
        text: elementData.text || 'Sample Text',
        content: elementData.content || '',
        src: elementData.src || 'https://via.placeholder.com/150',
        alt: elementData.alt || 'Image'
      });

      return {
        html,
        css: template.css_template || '',
        component: classification.name,
        category: classification.category,
        confidence: classification.score
      };

    } catch (error) {
      console.error('Error processing element:', error);
      return this.createFallbackComponent(elementData);
    }
  }

  static async generateClasses(elementData) {
    const classes = [];
    
    // Add color class if available
    if (elementData.color) {
      const colorClass = await getColorClass(elementData.color);
      if (colorClass) {
        classes.push(colorClass.tailwind_class);
      }
    }

    // Add spacing classes based on dimensions
    if (elementData.width) {
      const spacingClass = await getSpacingClass(Math.min(elementData.width / 4, 32));
      if (spacingClass) {
        classes.push(spacingClass.tailwind_class.replace('p-', 'px-'));
      }
    }

    if (elementData.height) {
      const spacingClass = await getSpacingClass(Math.min(elementData.height / 4, 16));
      if (spacingClass) {
        classes.push(spacingClass.tailwind_class.replace('p-', 'py-'));
      }
    }

    // Add default styling
    classes.push('rounded', 'border');

    return classes;
  }

  static substituteTemplate(template, values) {
    let result = template;
    
    Object.entries(values).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      result = result.replace(new RegExp(placeholder, 'g'), value);
    });

    return result;
  }

  static createFallbackComponent(elementData) {
    const classes = ['p-4', 'border', 'rounded'];
    
    return {
      html: `<div class="${classes.join(' ')}">${elementData.text || 'Content'}</div>`,
      css: '',
      component: 'fallback_div',
      category: 'layout',
      confidence: 0
    };
  }

  static async processElements(elementsArray) {
    const processedElements = [];
    
    for (const element of elementsArray) {
      const processed = await this.processElement(element);
      processedElements.push({
        ...processed,
        position: {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height
        }
      });
    }

    return processedElements;
  }

  static generateLayoutStructure(processedElements) {
    // Sort elements by position (top to bottom, left to right)
    const sorted = processedElements.sort((a, b) => {
      if (Math.abs(a.position.y - b.position.y) < 20) {
        return a.position.x - b.position.x;
      }
      return a.position.y - b.position.y;
    });

    // Group elements into rows
    const rows = [];
    let currentRow = [];
    let currentY = -1;

    sorted.forEach(element => {
      if (currentY === -1 || Math.abs(element.position.y - currentY) < 20) {
        currentRow.push(element);
        currentY = element.position.y;
      } else {
        if (currentRow.length > 0) {
          rows.push(currentRow);
        }
        currentRow = [element];
        currentY = element.position.y;
      }
    });

    if (currentRow.length > 0) {
      rows.push(currentRow);
    }

    return rows;
  }

  static generateHTML(processedElements) {
    const rows = this.generateLayoutStructure(processedElements);
    
    let html = '<div class="container mx-auto p-4">\n';
    
    rows.forEach(row => {
      if (row.length === 1) {
        html += `  ${row[0].html}\n`;
      } else {
        html += '  <div class="flex gap-4">\n';
        row.forEach(element => {
          html += `    ${element.html}\n`;
        });
        html += '  </div>\n';
      }
    });
    
    html += '</div>';
    
    return html;
  }
}

export default ComponentService;