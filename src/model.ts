// gas-app-liff/Model.gs, gas-app/Model.gs の移植。ロジックは変更しない。
// (両プロジェクトで完全一致させる運用だったため、Cloudflare版ではこの1ファイルに統合する)

export const COMPANIES = ['ホンダカーズ佐賀', 'モビリティズ', 'たてものや', '佐賀バルーナーズ'] as const;
export const COMMUTES = ['車', '自転車', '電車・バス・徒歩'] as const;
export const HIRE_TYPES = ['新卒', '中途'] as const;

// 'commute'=通勤手段で絞る(値は「車」等)。'hasLicense'=運転免許証の有無で絞る(値は「あり」固定を想定)
export type DocCondition = { type: 'commute' | 'hasLicense'; value: string };

export type DocSampleImage = { url: string; caption?: string };

export type DocType = {
  key: string;
  label: string;
  requiresOriginal?: boolean;
  pdfAllowed?: boolean;
  wordAllowed?: boolean; // Word(.doc/.docx)ファイルの添付も受け付ける
  textAllowed?: boolean; // ファイル添付の代わりに、テキストを直接入力しての提出も受け付ける
  photoAllowed?: boolean; // 写真での提出を受け付けるか(未指定/true=可。falseにすると写真提出を禁止)
  sensitive?: boolean;
  condition?: DocCondition;
  companies?: string[]; // 空/未指定なら全社共通。指定した法人の内定者にのみ提出を求める
  hireTypes?: string[]; // 空/未指定なら新卒・中途どちらも対象。指定した区分の人にのみ提出を求める(中途入社対応)
  description?: string;
  sampleImages?: DocSampleImage[]; // 記入例・見本画像(あれば説明文の下に表示)
  // 資格証明書のように「対象ではあるが持っていない人もいる」書類向け。未提出のままでも進捗・完了判定を止めない
  // (relevantDocTypes参照。提出した場合は通常の書類と同じく承認が必要)
  optional?: boolean;
  // jinjer側に用意した「カスタム項目(ファイル形式)」のID。customMenuId/customItemIdの両方が空でない場合のみjinjer送信対象
  jinjerCustomMenuId?: string;
  jinjerCustomItemId?: string;
  jinjerRecordCode?: string; // カスタム項目が「項目追加(横)」形式の場合のみ必須。「項目羅列」形式なら空のまま
};

export const DOC_TYPES: DocType[] = [
  {
    key: 'resume', label: '履歴書', requiresOriginal: true, pdfAllowed: true,
    description:
      '📄 履歴書を提出してください。\n' +
      '✅ すでに原本を提出済みの方は、提出不要です。\n\n' +
      '写真で提出する場合は、文字がはっきり読める状態で撮影してください。PDFデータがあれば、そちらでの提出も可能です。\n' +
      '📮 原本は別途郵送・持参をお願いします。'
  },
  {
    key: 'guarantor', label: '身元保証書', requiresOriginal: true,
    description:
      '🤝 内定者の皆さんが入社後がんばることをヒューベストと約束するための書類です。入社前に必ず全員提出してください。\n\n' +
      '【記入時の注意点】\n' +
      '①必ずボールペンで記入してください\n' +
      '②会社によって様式が異なります。ご自身の配属先の様式かご確認ください\n' +
      '③右上の日付は「記入した日」を記入します\n' +
      '④印鑑証明が必要なのは保証人のみです\n' +
      '⑤捺印した印鑑と印鑑証明の印影が同じか必ず確認してください（印鑑証明もあわせて提出してください）\n' +
      '⑥未成年の方は保護者欄への記入も必要です\n' +
      '⑦記入を間違えた場合は書き直すか、訂正印（認め印）で訂正してください\n' +
      '⑧様式は公式LINEからダウンロードできます（配属先ごとに様式が異なるので印刷時にご注意ください）\n\n' +
      '📮 まずは写真で提出いただき、原本は別途郵送・持参をお願いします。'
  },
  {
    key: 'bank', label: '⚠️ 給与振込先届',
    description: '🏦 給与の振込先を確認するための書類です。通帳のコピーなど、口座名義・口座番号・支店名がわかるものを提出してください。'
  },
  {
    key: 'myNumber', label: 'マイナンバー確認書類', sensitive: true,
    description:
      '🪪 マイナンバーカード（両面）、またはマイナンバー通知カード＋本人確認書類の写しを提出してください。\n\n' +
      'お持ちでない方・紛失された方・有効期限が切れている方は、発行までお時間がかかりますので、お早めに申請してください。'
  },
  {
    key: 'residence', label: '⚠️ 住民票', requiresOriginal: true,
    description:
      '🏠 「住民票」ではなく「住民票謄本」を提出してください。\n' +
      '⚠️ 住民票とは異なりますのでご注意ください！\n' +
      '（世帯全員が記載されたもの。ひとり暮らしの場合はご本人のみで可）\n\n' +
      '・3ヶ月以内に取得したものが必要です\n' +
      '・役所の窓口のほか、マイナンバーカードがあればコンビニのマルチコピー機でも取得できます（一部のコンビニでは取得できないため事前にご確認ください）\n' +
      '・引っ越しの予定がある場合は、住所変更後に取得してください\n\n' +
      '📮 原本は別途郵送・持参をお願いします。'
  },
  {
    key: 'health', label: '健康診断書', requiresOriginal: true, pdfAllowed: true,
    description:
      '🏥 学校や職場で受診した直近1年以内の健康診断書を提出してください。\n\n' +
      '受診されていない方・最後の受診から1年以上経過している方は、病院での受診が必要です（検査項目は「入社時に必要な検査項目」とお伝えください）。\n\n' +
      '💰 会社負担での受診をご希望の場合は、事前にご連絡ください。精算のため、宛名が個人名でインボイス対応の領収書が必要です。\n\n' +
      '📮 原本は別途郵送・持参をお願いします。'
  },
  {
    key: 'withholding', label: '⚠️ 源泉徴収票（前職分）', requiresOriginal: true, pdfAllowed: true,
    description:
      '💰 前職やアルバイト先がある方が対象です。入社年の1月から入社前月までの期間に働いていた分を提出してください（その期間に就業していない場合は提出不要です）。\n\n' +
      '・複数の勤務先がある場合は、勤務先ごとに提出してください\n' +
      '・ヒューベストグループ内でのアルバイト分は会社側で確認できるため提出不要です\n\n' +
      '📮 原本、またはデータをお持ちの場合はそのデータでご提出ください（写真での提出はご遠慮ください）。'
  },
  {
    key: 'graduationCertificate', label: '⚠️ 卒業証明書', pdfAllowed: true,
    description:
      '🎓 卒業した学校が発行する「卒業証明書」を提出してください。\n' +
      '⚠️ 「卒業見込証明書」とは異なりますのでご注意ください！\n' +
      '高校卒業の方は「卒業証書」のコピーでも構いません。\n\n' +
      '学校の窓口や証明書発行システムで取得できます。'
  },
  {
    key: 'carRegistration', label: '車検証の写し', condition: { type: 'commute', value: '車' },
    description: '🚗 車で通勤される方が対象です。通勤に使用する車の車検証を提出してください。',
    sampleImages: [{ url: '/liff/samples/car-registration.png', caption: '車検証の見本（2023年1月4日より電子化されています）' }],
    jinjerCustomMenuId: '3', jinjerCustomItemId: '2', jinjerRecordCode: 'auto'
  },
  {
    key: 'carInsurance', label: '自動車保険証券の写し', condition: { type: 'commute', value: '車' },
    description:
      '🚗 車で通勤される方が対象です。通勤に使用する車の自動車保険証券を提出してください。\n\n' +
      '💡 自動車保険証券とは、保険契約の申し込み後に発行される「契約内容を証明する書面」です。保険契約書とは異なりますのでご注意ください（保険会社によって形式が異なります）。',
    sampleImages: [{ url: '/liff/samples/car-insurance.png', caption: '自動車保険証券の見本' }],
    jinjerCustomMenuId: '3', jinjerCustomItemId: '3', jinjerRecordCode: 'auto'
  },
  {
    key: 'licenseFront', label: '運転免許証（表面）', condition: { type: 'hasLicense', value: 'あり' },
    description: '運転免許証の表面（氏名・生年月日・免許証番号が記載されている面）の写しを提出してください。',
    jinjerCustomMenuId: '3', jinjerCustomItemId: '18', jinjerRecordCode: 'auto'
  },
  {
    key: 'licenseBack', label: '運転免許証（裏面）', condition: { type: 'hasLicense', value: 'あり' },
    description: '運転免許証の裏面（本籍・条件等が記載されている面）の写しを提出してください。',
    jinjerCustomMenuId: '3', jinjerCustomItemId: '19', jinjerRecordCode: 'auto'
  },
  {
    key: 'certificate1', label: '⚠️ 資格証明書（1）', optional: true,
    description:
      'お持ちの資格・免許があれば証明書の写しを提出してください（国家整備士資格・宅地建物取引士（宅建）など。必須ではありません。お持ちでない場合は提出不要です）。最大3件まで登録できます。\n\n' +
      '⚠️ 資格の合格証・免許証そのものではなく、受験票や講習の案内など「資格を証明する書類ではないもの」を提出してしまうケースがあります。下記の見本もあわせてご確認ください。',
    sampleImages: [
      { url: '/liff/samples/qualification-correct.jpg', caption: '✅ 正しい例（資格証明書として認められるもの）' },
      { url: '/liff/samples/qualification-wrong.jpg', caption: '❌ 誤った例（資格証明書として認められないもの）' }
    ],
    jinjerCustomMenuId: '3', jinjerCustomItemId: '10', jinjerRecordCode: 'auto'
  },
  {
    key: 'certificate2', label: '資格証明書（2）', optional: true,
    description: '2件目の資格証明書（国家整備士資格・宅建など）がある場合は、こちらから提出してください。',
    jinjerCustomMenuId: '3', jinjerCustomItemId: '11', jinjerRecordCode: 'auto'
  },
  {
    key: 'certificate3', label: '資格証明書（3）', optional: true,
    description: '3件目の資格証明書（国家整備士資格・宅建など）がある場合は、こちらから提出してください。',
    jinjerCustomMenuId: '3', jinjerCustomItemId: '12', jinjerRecordCode: 'auto'
  },
  {
    key: 'disabilityHandbook', label: '障害者手帳の写し', optional: true,
    description: '障害者手帳をお持ちの場合は、写しを提出してください（必須ではありません。お持ちでない場合は提出不要です）。',
    jinjerCustomMenuId: '3', jinjerCustomItemId: '22', jinjerRecordCode: 'auto'
  },
  {
    key: 'bikeInsurance', label: '自転車保険証の写し', condition: { type: 'commute', value: '自転車' },
    description:
      '🚲 自転車で通勤される方は、自転車保険への加入が条件です。\n\n' +
      '自転車保険とは、自転車事故によるご自身のケガを補償する「傷害保険」と、他人への賠償に備える「個人賠償責任保険」がセットになった保険です。\n\n' +
      '・加入済みの場合 → 保険証券を提出してください\n' +
      '・未加入の場合 → 加入手続き後、証券を提出してください\n\n' +
      '💡 ご家族の自動車保険の特約で対応できる場合もあります。迷ったら総務課にご相談ください。'
  },
  {
    key: 'leaseContract', label: '賃貸借契約書の写し', companies: ['佐賀バルーナーズ'],
    description: '🏠 入社時の住所で、ご本人名義の賃貸借契約がある方が対象です。契約書の写しを提出してください（ご本人名義の契約がない場合は提出不要です）。'
  },
  {
    key: 'sevenHabitsReport', label: '「7つの習慣」レポート課題', pdfAllowed: true, wordAllowed: true, textAllowed: true, photoAllowed: false,
    description:
      '📚 「7つの習慣」の課題レポートを提出してください。\n\n' +
      '・本は会社で用意します。お手元にない方はご連絡ください\n' +
      '・レポート用紙が足りない方は、公式LINEからダウンロードできます（文字数は自由です）\n\n' +
      'Word・PDFファイルの添付、または下の入力欄に直接テキストを入力してのご提出も可能です（写真での提出はできません）。'
  }
];

export const STATUS = {
  NONE: '未提出',
  REVIEW: '確認中',
  ORIGINAL_WAIT: '原本提出待ち',
  APPROVED: '承認済',
  REJECTED: '差し戻し',
  NA: '対象外'
} as const;

export type StatusValue = (typeof STATUS)[keyof typeof STATUS];

export const REJECT_TEMPLATES = [
  { title: '画像が不鮮明', text: '画像が不鮮明です。文字がはっきり読める写真を再度アップロードしてください。' },
  { title: '有効期限切れ', text: '提出いただいた書類の有効期限が切れています。発行から3ヶ月以内のものを再提出してください。' },
  { title: '記入漏れ・記入ミス', text: '必要事項の記入に漏れ、または誤りがあります。内容をご確認のうえ再提出してください。' },
  { title: '氏名・情報の不一致', text: 'ご提出書類の氏名または情報が、ご入力内容と一致していません。正しい書類を再提出してください。' },
  { title: '書類の種類違い', text: 'アップロードいただいた書類が、ご依頼した書類と異なるようです。正しい書類を再提出してください。' }
];

export const REMINDER_TEMPLATES = [
  { title: '提出期限が近づいています', text: '入社予定日が近づいています。未提出の書類のご準備をお願いいたします。' },
  { title: '書類未提出のご案内', text: 'まだご提出いただいていない書類がございます。ご都合のよいタイミングでご提出をお願いいたします。' },
  { title: 'ご不明点の確認', text: '書類のご準備で分からない点がございましたら、このトークにご返信ください。' }
];

export type EmployeeLike = {
  EmployeeId?: string;
  Company?: string;
  Commute?: string;
  HasLicense?: string;
  HireType?: string;
};

// requiredOverride: 個別社員に対する提出要否の上書き(submissions.RequiredOverrideの値)。
// null/undefined=通常通り書類マスタの条件で判定。1=この人だけ強制的に対象にする。0=この人だけ強制的に対象外にする。
export type DocStatusMap = Record<string, { status?: string; requiredOverride?: number | null }>;

export function docMeta(key: string, docTypes: DocType[] = DOC_TYPES): DocType | null {
  return docTypes.find((d) => d.key === key) ?? null;
}

// employeeはEmployees行相当(Company/Commute/HasLicenseはこの綴りのプロパティ名)を想定。
// 配属先(companies)・通勤手段・運転免許証の有無(condition)は独立した軸なので、すべての条件を満たす場合のみ対象とする。
// requiredOverrideが指定されている場合は、書類マスタの条件より優先する(個別社員向けの例外設定)。
export function isApplicable(doc: DocType, employee: EmployeeLike, requiredOverride?: number | null): boolean {
  if (requiredOverride === 1) return true;
  if (requiredOverride === 0) return false;
  if (doc.companies && doc.companies.length > 0 && !doc.companies.includes(employee.Company || '')) return false;
  if (doc.hireTypes && doc.hireTypes.length > 0 && !doc.hireTypes.includes(employee.HireType || '')) return false;
  if (doc.condition) {
    if (doc.condition.type === 'commute') return employee.Commute === doc.condition.value;
    if (doc.condition.type === 'hasLicense') return employee.HasLicense === doc.condition.value;
  }
  return true;
}

export function applicableDocTypes(employee: EmployeeLike, docTypes: DocType[] = DOC_TYPES, docsByKey: DocStatusMap = {}): DocType[] {
  return docTypes.filter((d) => isApplicable(d, employee, docsByKey[d.key]?.requiredOverride));
}

// 進捗率・完了判定(受入準備完了かどうか)の対象となる書類。資格証明書のような任意(optional)の書類は、
// 未提出(NONE)のままなら対象から除外する(持っていない人がずっと「未提出」のまま止まってしまうのを防ぐ)。
// 提出済みになった場合は通常の書類と同じ扱いに戻り、承認されるまでは完了とみなさない。
function relevantDocTypes(employee: EmployeeLike, docsByKey: DocStatusMap, docTypes: DocType[]): DocType[] {
  return applicableDocTypes(employee, docTypes, docsByKey).filter(
    (d) => !d.optional || (docsByKey[d.key]?.status || STATUS.NONE) !== STATUS.NONE
  );
}

export function computeStage(employee: EmployeeLike, docsByKey: DocStatusMap, docTypes: DocType[] = DOC_TYPES): string {
  const applicable = relevantDocTypes(employee, docsByKey, docTypes);
  const statuses = applicable.map((d) => docsByKey[d.key]?.status || STATUS.NONE);

  if (statuses.includes(STATUS.REJECTED)) return '差し戻し';

  // 原本の提出が必要な書類(requiresOriginal)は、guarantor(身元保証書)に限らずどれでも同じ扱いにする。
  // それ以外の書類がすべて承認済みで、原本必要な書類が(承認済みor原本提出待ち)かつ1件でも原本提出待ちなら「原本待ち」。
  const originalDocs = applicable.filter((d) => d.requiresOriginal);
  const otherDocs = applicable.filter((d) => !d.requiresOriginal);
  const othersApproved = otherDocs.every((d) => (docsByKey[d.key]?.status || STATUS.NONE) === STATUS.APPROVED);
  const originalDocsSettled = originalDocs.every((d) => {
    const s = docsByKey[d.key]?.status || STATUS.NONE;
    return s === STATUS.APPROVED || s === STATUS.ORIGINAL_WAIT;
  });
  const anyOriginalWaiting = originalDocs.some((d) => (docsByKey[d.key]?.status || STATUS.NONE) === STATUS.ORIGINAL_WAIT);
  if (othersApproved && originalDocsSettled && anyOriginalWaiting) return '原本待ち';

  if (statuses.every((s) => s === STATUS.NONE)) return '未提出';
  if (statuses.every((s) => s === STATUS.APPROVED)) return '受入準備完了';
  return '確認中';
}

export function progressPct(employee: EmployeeLike, docsByKey: DocStatusMap, docTypes: DocType[] = DOC_TYPES): number {
  const applicable = relevantDocTypes(employee, docsByKey, docTypes);
  if (applicable.length === 0) return 100;
  const done = applicable.filter((d) => (docsByKey[d.key]?.status || STATUS.NONE) !== STATUS.NONE).length;
  return Math.round((done / applicable.length) * 100);
}
