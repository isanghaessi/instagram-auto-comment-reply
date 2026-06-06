import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRule } from '../src/poller/matcher.js';

test('matches contains_any keywords from comma-separated text', () => {
  assert.equal(matchesRule('쿠폰 링크 주세요', {
    match_mode: 'contains_any',
    keyword_text: '쿠폰, 할인'
  }), true);
});

test('contains_any matching is case-insensitive', () => {
  assert.equal(matchesRule('Please send the LINK', {
    match_mode: 'contains_any',
    keyword_text: 'coupon, link'
  }), true);
});

test('contains_any trims whitespace and ignores empty keywords', () => {
  assert.equal(matchesRule('할인 코드 있나요?', {
    match_mode: 'contains_any',
    keyword_text: '  ,   할인  ,  '
  }), true);
  assert.equal(matchesRule('아무 키워드 없음', {
    match_mode: 'contains_any',
    keyword_text: '  , ,  '
  }), false);
});

test('unsupported match modes do not match', () => {
  assert.equal(matchesRule('쿠폰 링크 주세요', {
    match_mode: 'contains_all',
    keyword_text: '쿠폰, 링크'
  }), false);
});
