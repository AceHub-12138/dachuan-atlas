import { describe, expect, it } from 'vitest';
import {
  isCommitSha,
  isPackageSpecifier,
  isRepoFileReference,
  looksLikePathDerivedLabel,
  normalizeRelativePath,
  parseSourceLine,
  shortCommit,
} from '../../src/architecture/paths';

describe('跨平台路径归一化', () => {
  it('把 Windows 反斜杠转为 POSIX 相对路径', () => {
    expect(normalizeRelativePath('src\\lib\\voice\\microphone.ts')).toEqual({
      ok: true,
      path: 'src/lib/voice/microphone.ts',
    });
  });

  it('接受 ./ 前缀并折叠重复分隔符', () => {
    expect(normalizeRelativePath('./src//lib/voice/microphone.ts')).toEqual({
      ok: true,
      path: 'src/lib/voice/microphone.ts',
    });
  });

  it('拒绝 macOS / Linux 绝对路径', () => {
    expect(normalizeRelativePath('/Users/example/secret.ts')).toMatchObject({ ok: false, reason: 'absolute' });
    expect(normalizeRelativePath('/home/user/secret.ts')).toMatchObject({ ok: false, reason: 'absolute' });
  });

  it('拒绝 Windows 盘符与 UNC 路径', () => {
    expect(normalizeRelativePath('C:\\Users\\apple\\secret.ts')).toMatchObject({ ok: false, reason: 'absolute' });
    expect(normalizeRelativePath('\\\\server\\share\\secret.ts')).toMatchObject({ ok: false, reason: 'absolute' });
  });

  it('拒绝 ~ 与 .. 越界', () => {
    expect(normalizeRelativePath('~/secret.ts')).toMatchObject({ ok: false, reason: 'absolute' });
    expect(normalizeRelativePath('src/../../secret.ts')).toMatchObject({ ok: false, reason: 'traversal' });
  });

  it('保留中文与空格文件名', () => {
    expect(normalizeRelativePath('src/模块 说明.ts')).toEqual({ ok: true, path: 'src/模块 说明.ts' });
  });
});

describe('源码定位与包名判断', () => {
  it('解析 Graphify 的 L 行号', () => {
    expect(parseSourceLine('L23')).toBe(23);
    expect(parseSourceLine('L23-L40')).toBe(23);
    expect(parseSourceLine('23')).toBe(23);
    expect(parseSourceLine(undefined)).toBeNull();
    expect(parseSourceLine('unknown')).toBeNull();
  });

  it('区分仓库文件与包名', () => {
    expect(isRepoFileReference('src/lib/voice/microphone.ts')).toBe(true);
    expect(isRepoFileReference('@playwright/test')).toBe(false);
    expect(isRepoFileReference('C:\\repo\\src\\a.ts')).toBe(false);
    expect(isPackageSpecifier('@playwright/test')).toBe(true);
    expect(isPackageSpecifier('react')).toBe(true);
    expect(isPackageSpecifier('src/lib/voice/microphone.ts')).toBe(false);
  });

  it('识别由绝对路径 slug 化的外部标签', () => {
    expect(looksLikePathDerivedLabel('users_apple_desktop_codex_graphify_poc_source')).toBe(true);
    expect(looksLikePathDerivedLabel('c_users_apple_secret')).toBe(true);
    expect(looksLikePathDerivedLabel('VoiceMicrophone')).toBe(false);
    expect(looksLikePathDerivedLabel('src_lib_voice_microphone')).toBe(false);
  });

  it('校验提交 SHA 与短 SHA', () => {
    const sha = '2584284e3e7b994d0510d9d53b2a302e3aa740bc';
    expect(isCommitSha(sha)).toBe(true);
    expect(isCommitSha('2584284')).toBe(false);
    expect(shortCommit(sha)).toBe('2584284');
    expect(shortCommit('unknown')).toBe('unknown');
  });
});
