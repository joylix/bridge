/**
 * RFC 8785 JSON Canonicalization Scheme（JCS）的最小实现。
 *
 * 只处理 JSON 数据模型：null / boolean / number / string / array / object。
 * 用于 rulesetId：对象键按 UTF-16 code unit 排序，数字按 ECMAScript
 * Number::toString，字符串按 JSON.stringify（不额外转义非 ASCII）。
 */

export function jcs(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      if (!Number.isFinite(value)) throw new Error('JCS 不支持 NaN / Infinity');
      if (Object.is(value, -0)) return '0';
      return JSON.stringify(value) as string;
    }
    case 'string':
      return JSON.stringify(value) as string;
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => jcs(item)).join(',')}]`;
      }
      const object = value as Record<string, unknown>;
      const keys = Object.keys(object).sort();
      const entries = keys.map((key) => {
        const item = object[key];
        if (item === undefined) throw new Error(`JCS 不支持 undefined（键 "${key}"）`);
        return `${JSON.stringify(key)}:${jcs(item)}`;
      });
      return `{${entries.join(',')}}`;
    }
    default:
      throw new Error(`JCS 不支持类型 ${typeof value}`);
  }
}
