/**
 * IR 的 JSON / YAML 载入。
 *
 * YAML 是第二表面语法：只允许表达 IR 已有字段。v0.4/legacy YAML
 * 到 IR 的迁移属于 Phase 2，不在本模块中静默进行。
 */

import yaml from 'js-yaml';
import { validateIr } from './validate';
import type { ParseOptions, ParseResult } from './types';

export function parseIrJson(text: string, options: ParseOptions = {}): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ir: null,
      diagnostics: [
        {
          code: 'JSON_PARSE_ERROR',
          severity: 'error',
          message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
          location: { ...(options.file ? { file: options.file } : {}), line: 1 },
        },
      ],
    };
  }
  return validateIr(value, options);
}

export function parseIrYaml(text: string, options: ParseOptions = {}): ParseResult {
  let value: unknown;
  try {
    value = yaml.load(text);
  } catch (error) {
    return {
      ir: null,
      diagnostics: [
        {
          code: 'YAML_PARSE_ERROR',
          severity: 'error',
          message: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`,
          location: { ...(options.file ? { file: options.file } : {}), line: 1 },
        },
      ],
    };
  }
  return validateIr(value, options);
}
