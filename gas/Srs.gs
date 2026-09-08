/**
 * SM-2（Anki 互換の4段階評価）。要件 §5.1。
 *
 * schedule() は純粋関数。ランダム性は fuzzFn で注入できるようにして
 * テストから固定できるようにしてある。
 */

var EASE_MIN = 1.3;
var EASE_INITIAL = 2.5;
var EASE_RECOVERY = 0.05;
var HARD_FACTOR = 1.2;
var EASY_BONUS = 1.3;
var INTERVAL_MAX_DAYS = 730;
var MASTERED_INTERVAL_DAYS = 180;

/**
 * 復習日を散らすためのゆらぎ。短い間隔ほど相対的に大きく散らす（Anki と同等の考え方）。
 * 一律のパーセントにすると、長い間隔で数十日単位の誤差になってしまう。
 */
function fuzzInterval(interval, rand) {
  if (interval < 2) return Math.max(1, Math.round(interval));
  var pct = (interval < 7) ? 0.25 : (interval < 20) ? 0.15 : 0.05;
  var f = 1 + (rand() * 2 - 1) * pct;
  return Math.max(1, Math.round(interval * f));
}

/**
 * @param {Object} item  { ease, interval, reps, lapses }
 * @param {number} grade 0=Again 1=Hard 2=Good 3=Easy
 *   UI は Again(0) と Perfect(2) の 2 つだけを出すが、
 *   Reviews のログと将来の拡張のため 4 段階すべてを受け付ける。
 * @param {string} today 'yyyy-MM-dd'
 * @param {function=} fuzzFn 0..1 を返す関数（省略時 Math.random）
 * @param {number=} maxIntervalDays 間隔の上限（日）。0/未指定で無制限
 * @return {{ease, interval, reps, lapses, due_date, status}}
 */
function schedule(item, grade, today, fuzzFn, maxIntervalDays) {
  var rand = fuzzFn || Math.random;
  var ease = toNumber(item && item.ease, EASE_INITIAL);
  var interval = toNumber(item && item.interval, 0);
  var reps = toNumber(item && item.reps, 0);
  var lapses = toNumber(item && item.lapses, 0);
  var status;

  if (grade === GRADE.AGAIN) {
    reps = 0;
    lapses += 1;
    ease = Math.max(EASE_MIN, ease - 0.20);
    interval = 0;                       // 当日中に再出題（セッション内キューで処理）
    status = STATUS.LEARNING;
  } else if (reps === 0) {              // 初回、または忘却直後の再学習
    interval = (grade === GRADE.EASY) ? 4 : 1;
    if (grade === GRADE.HARD) ease = Math.max(EASE_MIN, ease - 0.15);
    if (grade === GRADE.EASY) ease = ease + 0.15;
    reps = 1;
    status = STATUS.REVIEW;
  } else {
    if (grade === GRADE.HARD) {
      ease = Math.max(EASE_MIN, ease - 0.15);
      interval = interval * HARD_FACTOR;
    } else if (grade === GRADE.GOOD) {
      // 忘れて下がった ease を少しずつ戻す（平均回帰）。
      // 2 ボタン運用では ease を上げる手段が Good しかないため、
      // 一度つまずいたカードが永久に短い間隔のままになるのを防ぐ。
      ease = Math.min(EASE_INITIAL, ease + EASE_RECOVERY);
      interval = interval * ease;
    } else if (grade === GRADE.EASY) {
      ease = ease + 0.15;
      interval = interval * ease * EASY_BONUS;
    }
    reps += 1;
    status = STATUS.REVIEW;
  }

  var cap = toNumber(maxIntervalDays, 0);
  var due;
  if (interval > 0) {
    interval = fuzzInterval(interval, rand);
    if (cap > 0 && interval > cap) {
      // 上限に張り付いたカードが同じ日に固まらないよう、上限の 70〜100% に散らす
      interval = Math.round(cap * (0.7 + rand() * 0.3));
    }
    if (interval < 1) interval = 1;
    if (interval > INTERVAL_MAX_DAYS) interval = INTERVAL_MAX_DAYS;
    due = addDays(today, interval);
  } else {
    due = today;
  }

  if (interval >= MASTERED_INTERVAL_DAYS && lapses === 0) status = STATUS.MASTERED;

  return {
    ease: Math.round(ease * 1000) / 1000,
    interval: interval,
    reps: reps,
    lapses: lapses,
    due_date: due,
    status: status
  };
}

/**
 * 各評価を押した場合の次回間隔を、UI のボタンに出すために事前計算する。
 * fuzz は 0 固定（表示は代表値でよい）。
 */
function previewIntervals(item, today, maxIntervalDays) {
  var out = {};
  var noFuzz = function () { return 0.5; };
  [GRADE.AGAIN, GRADE.HARD, GRADE.GOOD, GRADE.EASY].forEach(function (g) {
    var r = schedule(item, g, today, noFuzz, maxIntervalDays);
    out[g] = r.interval;
  });
  return out;
}

/** 間隔（日）を人が読める表記にする */
function formatInterval(days) {
  var d = toNumber(days, 0);
  if (d <= 0) return '今日';
  if (d === 1) return '1日';
  if (d < 30) return d + '日';
  if (d < 365) return Math.round(d / 30 * 10) / 10 + 'ヶ月';
  return Math.round(d / 365 * 10) / 10 + '年';
}
