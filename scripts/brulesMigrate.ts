/**
 * legacy YAML → BRULES v0.5 IR 迁移 CLI。
 *
 * 用法：
 *   npx vite-node scripts/brulesMigrate.ts <rules.yml> [options]
 *
 * 选项：
 *   --json                 输出完整迁移报告 JSON
 *   --report <file>        写出迁移报告 JSON
 *   --ir <file>            写出迁移后的 IR JSON
 *   --generated-at <iso>   固定报告时间（用于可重复构建）
 *   --system <name>        覆盖 SYSTEM 文件头
 *   --code <code>          只显示指定诊断码
 *   --severity <level>     只显示 error/warning/info
 *   --rule <id>            只显示指定规则
 *   --strict               有 unsupported / manual-review 时退出 1
 *   --verbose              显示全部报告项
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  detectInputVersion,
  filterMigrationEntries,
  migrateText,
  type DiagnosticSeverity,
  type MigrationFilter,
} from '../src/brules/index';

interface CliOptions {
  file: string;
  json: boolean;
  report?: string;
  ir?: string;
  generatedAt?: string;
  system?: string;
  code?: string;
  severity?: DiagnosticSeverity;
  rule?: string;
  strict: boolean;
  verbose: boolean;
}

function usage(): void {
  console.log(
    [
      'BRULES legacy YAML → v0.5 IR 迁移器',
      '',
      '用法: npx vite-node scripts/brulesMigrate.ts <rules.yml> [options]',
      '',
      '  --json                 输出完整迁移报告 JSON',
      '  --report <file>        写出迁移报告 JSON',
      '  --ir <file>            写出迁移后的 IR JSON',
      '  --generated-at <iso>   固定 generatedAt',
      '  --system <name>        覆盖 SYSTEM',
      '  --code <code>          只看指定诊断码',
      '  --severity <level>     error / warning / info',
      '  --rule <id>            只看指定规则',
      '  --strict               有 unsupported / manual-review 时退出 1',
      '  --verbose              显示全部报告项',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    file: '',
    json: false,
    strict: false,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => {
      index += 1;
      const value = argv[index];
      if (value === undefined) throw new Error(`${arg} 缺少参数`);
      return value;
    };
    switch (arg) {
      case '--json':
        options.json = true;
        break;
      case '--report':
        options.report = next();
        break;
      case '--ir':
        options.ir = next();
        break;
      case '--generated-at':
        options.generatedAt = next();
        break;
      case '--system':
        options.system = next();
        break;
      case '--code':
        options.code = next();
        break;
      case '--severity': {
        const value = next();
        if (value !== 'error' && value !== 'warning' && value !== 'info') {
          throw new Error(`--severity 只接受 error/warning/info，收到 ${value}`);
        }
        options.severity = value;
        break;
      }
      case '--rule':
        options.rule = next();
        break;
      case '--strict':
        options.strict = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`未知选项 ${arg}`);
        if (options.file) throw new Error('一次只能迁移一个文件');
        options.file = arg;
    }
  }
  if (!options.file) {
    usage();
    throw new Error('缺少输入文件');
  }
  return options;
}

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, JSON.stringify(value, null, 2) + '\n', 'utf8');
  console.log(`已写出 ${path}`);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function main(): void {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  const text = readFileSync(resolve(options.file), 'utf8');
  const detected = detectInputVersion(text);
  const result = migrateText(text, {
    file: options.file,
    source: options.file,
    ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
    ...(options.system ? { system: options.system } : {}),
  });
  const { report } = result;

  if (options.report) writeJson(options.report, report);
  if (options.ir) {
    if (!result.ir) {
      console.error('没有可写出的 IR：迁移存在 error。');
    } else {
      writeJson(options.ir, result.ir);
    }
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const summary = report.summary;
    console.log(`\n${report.source}`);
    console.log(`  输入版本: ${report.sourceVersion} → ${report.targetVersion}（检测：${detected.kind}）`);
    console.log(`  generatedAt: ${report.generatedAt}`);
    console.log(
      `  rules: ${summary.rules} 源规则；IR ${summary.executableIrRules} 条；可执行源规则 ${summary.executableSourceRules}（${percent(summary.executableRate)}）`,
    );
    console.log(
      `  dispositions: autoMigrated=${summary.autoMigrated} manualReview=${summary.manualReview} unsupported=${summary.unsupported}`,
    );
    console.log(
      `  entries: ${summary.entries}（error ${summary.bySeverity.error} / warning ${summary.bySeverity.warning} / info ${summary.bySeverity.info}）`,
    );
    console.log(
      `  coverage: ${report.coverage.usedKeys} 个条件键在用；shapeClass ${report.coverage.shapeClass.count} 次；未知键 ${report.coverage.unknownKeys.length}`,
    );
    console.log(`  rulesetId: ${report.rulesetId ?? '<不可用>'}`);
    if (report.unsupportedRules.length > 0) {
      console.log(`  不可执行规则 (${report.unsupportedRules.length}):`);
      for (const rule of report.unsupportedRules) {
        console.log(`    - ${rule.ruleId}:${rule.line} ${rule.reason}`);
      }
    }
    const filter: MigrationFilter = {
      ...(options.code ? { code: options.code as MigrationFilter['code'] } : {}),
      ...(options.severity ? { severity: options.severity } : {}),
      ...(options.rule ? { ruleId: options.rule } : {}),
    };
    const entries = filterMigrationEntries(
      options.verbose
        ? report.entries
        : report.entries.filter((entry) => entry.severity !== 'info' || options.verbose),
      filter,
    );
    console.log(`  报告项 ${entries.length}：`);
    const limit = options.verbose ? entries.length : Math.min(entries.length, 80);
    for (const entry of entries.slice(0, limit)) {
      const where = [entry.ruleId ?? '<file>', entry.line].filter(Boolean).join(':');
      console.log(`    ${where} ${entry.severity} ${entry.code}: ${entry.reason}`);
    }
    if (entries.length > limit) console.log(`    … 另有 ${entries.length - limit} 项（用 --verbose 查看）`);
  }

  const hasError = report.summary.bySeverity.error > 0;
  const strictFailure =
    options.strict && (report.summary.unsupported > 0 || report.summary.manualReview > 0);
  process.exit(hasError || strictFailure ? 1 : 0);
}

main();
