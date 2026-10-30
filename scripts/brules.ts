/**
 * BRULES v0.5 规则集检查器。
 *
 * 用法：
 *   npx vite-node scripts/brules.ts <file...> [--json]
 *
 * 支持：
 *   - .brules / .rules      v0.5 行式 DSL
 *   - .json                 IR JSON
 *   - .yaml / .yml          IR YAML
 *
 * 退出码：0 = 无 error；1 = 至少一个 error 或文件读取失败。
 */

import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import {
  compileRules,
  countSeverity,
  formatDiagnostic,
  parseDsl,
  parseIrJson,
  parseIrYaml,
  type Diagnostic,
  type ParseResult,
} from '../src/brules/index';

interface FileReport {
  file: string;
  system?: string;
  systemVersion?: string;
  rulesetId: string | null;
  rules: Array<{
    id: string;
    action: string;
    sequence: string;
    priority: number;
    specificity: number;
  }>;
  diagnostics: Diagnostic[];
}

function usage(): void {
  console.log(
    [
      'BRULES v0.5 规则集检查器',
      '',
      '用法: npx vite-node scripts/brules.ts <file...> [--json]',
      '',
      '  .brules / .rules  v0.5 行式 DSL',
      '  .json             IR JSON',
      '  .yaml / .yml      IR YAML',
      '  --json            输出机器可读 JSON',
    ].join('\n'),
  );
}

function load(file: string): ParseResult {
  const absolute = resolve(file);
  const text = readFileSync(absolute, 'utf8');
  const ext = extname(absolute).toLowerCase();
  switch (ext) {
    case '.brules':
    case '.rules':
      return parseDsl(text, { file });
    case '.json':
      return parseIrJson(text, { file });
    case '.yaml':
    case '.yml':
      return parseIrYaml(text, { file });
    default:
      throw new Error(`不支持的文件扩展名 "${ext || '<none>'}"；请使用 .brules / .json / .yaml`);
  }
}

function check(file: string): FileReport {
  const parsed = load(file);
  if (!parsed.ir) {
    return {
      file,
      rulesetId: null,
      rules: [],
      diagnostics: parsed.diagnostics,
    };
  }
  const compiled = compileRules(parsed.ir, { file });
  return {
    file,
    system: parsed.ir.system,
    ...(parsed.ir.systemVersion ? { systemVersion: parsed.ir.systemVersion } : {}),
    rulesetId: compiled.rulesetId,
    rules: compiled.rules.map((rule) => ({
      id: rule.id,
      action: rule.action,
      sequence: rule.sequence,
      priority: rule.priority,
      specificity: rule.specificity,
    })),
    diagnostics: [...parsed.diagnostics, ...compiled.diagnostics],
  };
}

function printReport(report: FileReport): void {
  console.log(`\n${report.file}`);
  if (report.system) {
    console.log(`  system: ${report.system}${report.systemVersion ? ` ${report.systemVersion}` : ''}`);
  }
  console.log(`  rulesetId: ${report.rulesetId ?? '<不可用>'}`);
  console.log(
    `  rules: ${report.rules.length}；diagnostics: ${countSeverity(report.diagnostics, 'error')} error / ${countSeverity(report.diagnostics, 'warning')} warning / ${countSeverity(report.diagnostics, 'info')} info`,
  );
  for (const rule of report.rules) {
    console.log(
      `  - ${rule.id}  ${rule.action}  ${rule.sequence}  prio=${rule.priority} spec=${rule.specificity}`,
    );
  }
  for (const diagnostic of report.diagnostics) {
    console.log(`  ${formatDiagnostic(diagnostic)}`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    usage();
    process.exit(argv.length === 0 ? 1 : 0);
  }
  const json = argv.includes('--json');
  const files = argv.filter((arg) => !arg.startsWith('--'));
  if (files.length === 0) {
    usage();
    process.exit(1);
  }

  const reports: FileReport[] = [];
  let fatal = false;
  for (const file of files) {
    try {
      reports.push(check(file));
    } catch (error) {
      fatal = true;
      reports.push({
        file,
        rulesetId: null,
        rules: [],
        diagnostics: [
          {
            code: 'INVALID_RULESET',
            severity: 'error',
            message: error instanceof Error ? error.message : String(error),
            location: { file, line: 1 },
          },
        ],
      });
    }
  }

  if (json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const report of reports) printReport(report);
  }

  const hasErrors = fatal || reports.some((report) => countSeverity(report.diagnostics, 'error') > 0);
  process.exit(hasErrors ? 1 : 0);
}

main();
