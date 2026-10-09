import { createUserCallLimiter } from './userCallLimiter.js';

const WINDOW_MS = 1000;
const LIMIT = 3;

const buildClock = start => {
  let current = start;
  return {
    now: () => current,
    advance: ms => {
      current += ms;
    },
  };
};

describe('userCallLimiter', () => {
  let limiter;
  let clock;
  const attempt = key =>
    limiter.tryConsume(key, { limit: LIMIT, windowMs: WINDOW_MS, now: clock.now });

  beforeEach(() => {
    limiter = createUserCallLimiter();
    clock = buildClock(10000);
  });

  it('allows calls up to the limit and rejects the next one', () => {
    const outcomes = [1, 2, 3, 4].map(() => attempt('u1'));

    expect(outcomes).toEqual([true, true, true, false]);
  });

  it('tracks users independently', () => {
    [1, 2, 3].forEach(() => attempt('u1'));

    expect(attempt('u2')).toBe(true);
    expect(attempt('u1')).toBe(false);
  });

  it('allows calls again once the window has passed', () => {
    [1, 2, 3].forEach(() => attempt('u1'));

    clock.advance(WINDOW_MS - 1);
    expect(attempt('u1')).toBe(false);
    clock.advance(1);
    expect(attempt('u1')).toBe(true);
  });

  it('slides the window so only expired calls free a slot', () => {
    attempt('u1');
    clock.advance(600);
    attempt('u1');
    attempt('u1');

    clock.advance(400);
    expect(attempt('u1')).toBe(true);
    expect(attempt('u1')).toBe(false);
  });

  it('does not count rejected calls against the window', () => {
    [1, 2, 3].forEach(() => attempt('u1'));
    clock.advance(WINDOW_MS / 2);
    [1, 2, 3].forEach(() => attempt('u1'));

    clock.advance(WINDOW_MS / 2);

    expect(attempt('u1')).toBe(true);
  });

  it('forgets everything on reset', () => {
    [1, 2, 3].forEach(() => attempt('u1'));

    limiter.reset();

    expect(attempt('u1')).toBe(true);
  });

  it('drops expired keys when many users have been tracked', () => {
    for (let index = 0; index < 1100; index += 1) attempt(`user-${index}`);
    clock.advance(WINDOW_MS);

    expect(attempt('late-user')).toBe(true);
    expect(limiter.size()).toBeLessThan(1100);
  });

  it('keeps blocking and recovers after a window when the clock goes backwards', () => {
    [1, 2, 3].forEach(() => attempt('u1'));

    clock.advance(-5000);
    expect(attempt('u1')).toBe(false);
    clock.advance(WINDOW_MS);
    expect(attempt('u1')).toBe(true);
  });

  it('does not rebuild the whole table on every call', () => {
    const OriginalMap = Map;
    for (let index = 0; index < 50; index += 1) attempt(`user-${index}`);
    let constructed = 0;
    globalThis.Map = class extends OriginalMap {
      constructor(...args) {
        super(...args);
        constructed += 1;
      }
    };

    try {
      for (let index = 0; index < 50; index += 1) attempt(`user-${index}`);
    } finally {
      globalThis.Map = OriginalMap;
    }

    expect(constructed).toBe(0);
  });

  it('removes a key once all its calls expired and a sweep ran', () => {
    attempt('gone');
    for (let index = 0; index < 1100; index += 1) attempt(`filler-${index}`);
    clock.advance(WINDOW_MS);

    attempt('trigger');

    expect(limiter.size()).toBe(1);
  });
});
