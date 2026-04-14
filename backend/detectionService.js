// Mock OpenCV detection service
// In a real implementation, this would use actual OpenCV for image processing

export class DetectionService {
  
  static async detectElements(imagePath) {
    // Mock detected elements - in real implementation, this would use OpenCV
    const mockElements = [
      {
        x: 50,
        y: 100,
        width: 200,
        height: 40,
        color: '#3B82F6',
        text: 'Get Started',
        hasText: true,
        area: 8000,
        aspectRatio: 5.0
      },
      {
        x: 50,
        y: 200,
        width: 300,
        height: 35,
        color: '#FFFFFF',
        text: 'Enter your email',
        hasText: true,
        area: 10500,
        aspectRatio: 8.57
      },
      {
        x: 50,
        y: 50,
        width: 400,
        height: 30,
        color: '#000000',
        text: 'Welcome to Our App',
        hasText: true,
        area: 12000,
        aspectRatio: 13.33
      },
      {
        x: 400,
        y: 100,
        width: 250,
        height: 150,
        color: '#F3F4F6',
        text: '',
        hasText: false,
        area: 37500,
        aspectRatio: 1.67
      }
    ];

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return mockElements.map(element => ({
      ...element,
      confidence: 0.85 + Math.random() * 0.1 // Mock confidence score
    }));
  }

  static async extractFeatures(imagePath) {
    // Mock feature extraction
    return {
      totalElements: 4,
      averageSize: 17000,
      colorPalette: ['#3B82F6', '#FFFFFF', '#000000', '#F3F4F6'],
      layout: 'vertical',
      complexity: 'simple'
    };
  }

  // Helper methods for real OpenCV integration
  static calculateAspectRatio(width, height) {
    return width / height;
  }

  static calculateArea(width, height) {
    return width * height;
  }

  static isTextElement(element) {
    return element.hasText && element.text && element.text.length > 0;
  }

  static categorizeBySize(area) {
    if (area < 5000) return 'small';
    if (area < 20000) return 'medium';
    return 'large';
  }

  static getBrightness(hexColor) {
    // Convert hex to RGB and calculate brightness
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Calculate relative luminance
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    
    if (brightness > 128) return 'bright';
    return 'dark';
  }
}

export default DetectionService;