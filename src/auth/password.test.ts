import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('密码哈希', () => {
  it('使用 scrypt 格式，每次盐不同', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(second).not.toBe(first);
    expect(first).not.toContain('correct horse');
  });

  it('正确密码通过，错误密码失败', async () => {
    const stored = await hashPassword('s3cret-pass');
    await expect(verifyPassword('s3cret-pass', stored)).resolves.toBe(true);
    await expect(verifyPassword('s3cret-pas', stored)).resolves.toBe(false);
    await expect(verifyPassword('', stored)).resolves.toBe(false);
  });

  it('损坏或未知格式返回 false，不抛异常', async () => {
    for (const stored of ['', 'plaintext', 'bcrypt$x$y', 'scrypt$0$8$1$a$b', 'scrypt$16384$8$1$$']) {
      await expect(verifyPassword('anything', stored)).resolves.toBe(false);
    }
  });
});
