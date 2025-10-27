/**
 * Data Format Converter Utility
 * 
 * Provides conversion functions between different data formats:
 * - text/plain: Plain text string
 * - application/json: JSON object
 * - array: JavaScript array
 * 
 * Used by workflow nodes to convert input/output data formats
 */

export type DataFormat = 'text/plain' | 'application/json' | 'array';

export interface FormatConversionOptions {
  /** Source format */
  from: DataFormat;
  /** Target format */
  to: DataFormat;
  /** Data to convert */
  data: any;
  /** Array split delimiter for text to array conversion (default: '\n') */
  arraySplitDelimiter?: string;
  /** Array join delimiter for array to text conversion (default: '\n') */
  arrayJoinDelimiter?: string;
}

export interface FormatConversionResult {
  /** Whether conversion was successful */
  success: boolean;
  /** Converted data */
  data: any;
  /** Error message if conversion failed */
  error?: string;
  /** Conversion details for logging */
  details?: {
    from: DataFormat;
    to: DataFormat;
    originalType: string;
    resultType: string;
  };
}

/**
 * Convert data from one format to another
 */
export function convertFormat(options: FormatConversionOptions): FormatConversionResult {
  const { from, to, data, arraySplitDelimiter = '\n', arrayJoinDelimiter = '\n' } = options;

  console.log('[FormatConverter] Converting data:', {
    from,
    to,
    dataType: typeof data,
    isArray: Array.isArray(data),
    isNull: data === null || data === undefined,
  });

  // No conversion needed if formats are the same
  if (from === to) {
    return {
      success: true,
      data,
      details: {
        from,
        to,
        originalType: typeof data,
        resultType: typeof data,
      },
    };
  }

  try {
    let result: any;

    // Convert FROM text/plain
    if (from === 'text/plain') {
      const text = String(data || '');
      
      if (to === 'application/json') {
        result = convertTextToJson(text);
      } else if (to === 'array') {
        result = convertTextToArray(text, arraySplitDelimiter);
      }
    }
    // Convert FROM application/json
    else if (from === 'application/json') {
      if (to === 'text/plain') {
        result = convertJsonToText(data);
      } else if (to === 'array') {
        result = convertJsonToArray(data);
      }
    }
    // Convert FROM array
    else if (from === 'array') {
      const arr = Array.isArray(data) ? data : [data];
      
      if (to === 'text/plain') {
        result = convertArrayToText(arr, arrayJoinDelimiter);
      } else if (to === 'application/json') {
        result = arr; // Array is valid JSON
      }
    }

    console.log('[FormatConverter] Conversion successful:', {
      from,
      to,
      resultType: typeof result,
      isArray: Array.isArray(result),
    });

    return {
      success: true,
      data: result,
      details: {
        from,
        to,
        originalType: typeof data,
        resultType: typeof result,
      },
    };

  } catch (error: any) {
    console.error('[FormatConverter] Conversion failed:', {
      from,
      to,
      error: error.message,
    });

    return {
      success: false,
      data: null,
      error: `Format conversion failed: ${error.message}`,
      details: {
        from,
        to,
        originalType: typeof data,
        resultType: 'error',
      },
    };
  }
}

/**
 * Convert text to JSON
 * Attempts to parse as JSON, otherwise wraps in object
 */
function convertTextToJson(text: string): any {
  if (!text || text.trim().length === 0) {
    return { text: '' };
  }

  // Try to parse as JSON
  try {
    return JSON.parse(text);
  } catch {
    // If not valid JSON, wrap in object
    return { text: text };
  }
}

/**
 * Convert text to array
 * Splits by delimiter (default: newline)
 */
function convertTextToArray(text: string, delimiter: string = '\n'): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  return text
    .split(delimiter)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/**
 * Convert JSON to text
 * Stringifies JSON with pretty formatting
 */
function convertJsonToText(data: any): string {
  if (data === null || data === undefined) {
    return '';
  }

  // If already a string, return as-is
  if (typeof data === 'string') {
    return data;
  }

  // If object has a 'text' property, use it
  if (data && typeof data === 'object' && 'text' in data) {
    return String(data.text);
  }

  // If object has a 'message' property, use it
  if (data && typeof data === 'object' && 'message' in data) {
    return String(data.message);
  }

  // If object has a 'content' property, use it
  if (data && typeof data === 'object' && 'content' in data) {
    return String(data.content);
  }

  // Otherwise stringify with formatting
  return JSON.stringify(data, null, 2);
}

/**
 * Convert JSON to array
 * If root is array, use it; otherwise wrap in array
 */
function convertJsonToArray(data: any): any[] {
  if (data === null || data === undefined) {
    return [];
  }

  // Already an array
  if (Array.isArray(data)) {
    return data;
  }

  // If object has an array property, try to use it
  if (data && typeof data === 'object') {
    // Check for common array property names
    if ('items' in data && Array.isArray(data.items)) {
      return data.items;
    }
    if ('results' in data && Array.isArray(data.results)) {
      return data.results;
    }
    if ('data' in data && Array.isArray(data.data)) {
      return data.data;
    }
  }

  // Wrap single item in array
  return [data];
}

/**
 * Convert array to text
 * Joins array elements with delimiter (default: newline)
 */
function convertArrayToText(arr: any[], delimiter: string = '\n'): string {
  if (!arr || arr.length === 0) {
    return '';
  }

  return arr
    .map(item => {
      if (typeof item === 'string') {
        return item;
      }
      if (item && typeof item === 'object') {
        // Try to extract text from common properties
        if ('text' in item) return String(item.text);
        if ('message' in item) return String(item.message);
        if ('content' in item) return String(item.content);
        // Otherwise stringify
        return JSON.stringify(item);
      }
      return String(item);
    })
    .join(delimiter);
}

/**
 * Detect the format of data
 * Useful for auto-detection
 */
export function detectFormat(data: any): DataFormat {
  if (data === null || data === undefined) {
    return 'text/plain';
  }

  if (typeof data === 'string') {
    // Try to parse as JSON
    try {
      JSON.parse(data);
      return 'application/json';
    } catch {
      return 'text/plain';
    }
  }

  if (Array.isArray(data)) {
    return 'array';
  }

  if (typeof data === 'object') {
    return 'application/json';
  }

  return 'text/plain';
}

/**
 * Get display name for format
 */
export function getFormatDisplayName(format: DataFormat): string {
  switch (format) {
    case 'text/plain':
      return 'Plain Text';
    case 'application/json':
      return 'JSON Object';
    case 'array':
      return 'Array';
    default:
      return format;
  }
}

/**
 * Get icon name for format (for UI)
 */
export function getFormatIcon(format: DataFormat): string {
  switch (format) {
    case 'text/plain':
      return 'document';
    case 'application/json':
      return 'braces';
    case 'array':
      return 'list';
    default:
      return 'document';
  }
}

