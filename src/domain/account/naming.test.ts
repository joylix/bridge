import { describe, expect, it } from 'vitest';
import {
  displayWidth,
  normalizeEmail,
  normalizeNickname,
  normalizeUsername,
  validateEmail,
  validateNickname,
  validatePassword,
  validateUsername,
} from './naming';

describe('用户名', () => {
  it('接受 3–12 位字母开头的用户名并归一化查重值', () => {
    const result = validateUsername(' Alice_01 ');
    expect(result).toMatchObject({ ok: true, value: 'Alice_01', normalized: 'alice_01' });
    expect(normalizeUsername('  Alice_01 ')).toBe('alice_01');
  });

  it('拒绝长度、首字符、非法字符与保留名', () => {
    for (const bad of ['ab', '1alice', 'alice-01', 'alice 01', 'a'.repeat(13)]) {
      expect(validateUsername(bad)).toMatchObject({ ok: false, issue: 'format' });
    }
    expect(validateUsername('Admin')).toMatchObject({ ok: false, issue: 'reserved' });
    expect(validateUsername('support')).toMatchObject({ ok: false, issue: 'reserved' });
  });
});

describe('昵称', () => {
  it('按显示宽度限制 2–12：汉字/全角 2，ASCII 1', () => {
    expect(displayWidth('AB')).toBe(2);
    expect(displayWidth('小明')).toBe(4);
    expect(displayWidth('A桥')).toBe(3);
    expect(validateNickname('A')).toMatchObject({ ok: false, issue: 'format' });
    expect(validateNickname('小明')).toMatchObject({ ok: true, value: '小明' });
    expect(validateNickname('桥牌 玩家')).toMatchObject({ ok: true });
  });

  it('折叠空格、保留显示大小写，归一化值小写', () => {
    const result = validateNickname('  Alice   01  ');
    expect(result).toMatchObject({ ok: true, value: 'Alice 01', normalized: 'alice 01' });
    expect(normalizeNickname('  Alice   01  ')).toBe('alice 01');
  });

  it('拒绝 emoji、控制字符、保留名与超宽昵称', () => {
    expect(validateNickname('桥牌😀')).toMatchObject({ ok: false, issue: 'format' });
    expect(validateNickname('桥\u0000牌')).toMatchObject({ ok: false, issue: 'format' });
    expect(validateNickname('admin')).toMatchObject({ ok: false, issue: 'reserved' });
    expect(validateNickname('一二三四五六七')).toMatchObject({ ok: false, issue: 'format' });
  });
});

describe('邮箱与密码', () => {
  it('邮箱规范化为小写并校验基本格式', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(validateEmail('Alice@Example.COM')).toEqual({
      ok: true,
      value: 'alice@example.com',
    });
    expect(validateEmail('not-an-email')).toMatchObject({ ok: false });
  });

  it('密码至少 8 位，且不能与用户名或昵称相同', () => {
    expect(validatePassword('12345678', {})).toEqual({ ok: true });
    expect(validatePassword('short', {})).toMatchObject({ ok: false });
    expect(validatePassword('Alice_01', { username: 'Alice_01' })).toMatchObject({ ok: false });
    expect(validatePassword('小明小明', { nickname: '小明小明' })).toMatchObject({ ok: false });
    expect(validatePassword('x'.repeat(129), {})).toMatchObject({ ok: false });
  });
});
