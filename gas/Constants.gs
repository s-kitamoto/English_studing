/**
 * 定数定義。
 * シートの列順はここが唯一の正。列を増やすときは末尾に追加すること
 * （途中に挿入すると既存シートとずれる）。
 */

/** 設定画面に表示するアプリのバージョン。デプロイが反映されたかの目印も兼ねる */
var APP_VERSION = '0.2.0';

var SHEET = {
  ITEMS: 'Items',
  REVIEWS: 'Reviews',
  SETTINGS: 'Settings'
};

var ITEM_COLUMNS = [
  'id',
  'type',
  'text',
  'lemma',
  'phonetic',
  'pos',
  'meaning_ja',
  'meaning_en',
  'usage_note',
  'example',
  'example_ja',
  'source_url',
  'source_context',
  'encounter_count',
  'status',
  'due_date',
  'interval',
  'ease',
  'reps',
  'lapses',
  'last_reviewed_at',
  'created_at',
  'updated_at'
];

/** 日付(yyyy-MM-dd)として扱う列 */
var ITEM_DATE_COLUMNS = ['due_date'];
/** ISO8601 のタイムスタンプとして扱う列 */
var ITEM_TS_COLUMNS = ['last_reviewed_at', 'created_at', 'updated_at'];
/** 数値として扱う列 */
var ITEM_NUM_COLUMNS = ['encounter_count', 'interval', 'ease', 'reps', 'lapses'];

var REVIEW_COLUMNS = [
  'log_id',
  'item_id',
  'reviewed_at',
  'grade',
  'mode',
  'elapsed_ms',
  'prev_interval',
  'new_interval'
];

var TYPES = [
  { value: 'word', label: '単語' },
  { value: 'phrase', label: 'フレーズ' },
  { value: 'sentence', label: 'センテンス' }
];

/** pos は単一選択。type によって選択肢が変わる（要件 §4.8） */
var POS_BY_TYPE = {
  word: [
    { value: 'noun', label: '名詞' },
    { value: 'verb', label: '動詞' },
    { value: 'adjective', label: '形容詞' },
    { value: 'adverb', label: '副詞' },
    { value: 'preposition', label: '前置詞' },
    { value: 'conjunction', label: '接続詞' },
    { value: 'pronoun', label: '代名詞' },
    { value: 'interjection', label: '間投詞' }
  ],
  phrase: [
    { value: 'phrasal_verb', label: '句動詞' },
    { value: 'idiom', label: '慣用表現' },
    { value: 'collocation', label: 'コロケーション' },
    { value: 'noun_phrase', label: '名詞句' },
    { value: 'verb_phrase', label: '動詞句' }
  ],
  sentence: []
};

var STATUS = {
  NEW: 'new',
  LEARNING: 'learning',
  REVIEW: 'review',
  MASTERED: 'mastered',
  SUSPENDED: 'suspended',
  DELETED: 'deleted'
};

var STATUS_LABELS = {
  'new': '新規',
  'learning': '学習中',
  'review': '復習中',
  'mastered': '習得済み',
  'suspended': '休止',
  'deleted': '削除済み'
};

var GRADE = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };

var DEFAULT_SETTINGS = {
  daily_new_limit: 20,
  daily_review_limit: 100,
  session_size: 20,
  // 復習間隔の上限（日）。既定は 0 = 無制限（素の SM-2）。
  // 値を入れると「一度覚えたきり出てこない」がなくなる代わりに、
  // 語彙が増えるほど 1 日の復習量が線形に増える。
  max_interval_days: 0,
  tts_lang: 'en-US',
  enrich_provider: 'none'
};

/** Script Properties のキー */
var PROP = {
  TOKEN: 'WEBAPP_TOKEN',
  SPREADSHEET_ID: 'SPREADSHEET_ID'
};

/** source_context の保持上限 */
var CONTEXT_MAX_LEN = 300;
var CONTEXT_MAX_ENTRIES = 3;
var CONTEXT_SEPARATOR = '\n---\n';
