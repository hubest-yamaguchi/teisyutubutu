// gas-app-liff/Model.gs, gas-app/Model.gs の移植。ロジックは変更しない。
// (両プロジェクトで完全一致させる運用だったため、Cloudflare版ではこの1ファイルに統合する)

export const COMPANIES = ['ホンダカーズ佐賀', 'モビリティズ', 'たてものや', '佐賀バルーナーズ'] as const;
export const COMMUTES = ['車', '自転車', '電車・バス・徒歩'] as const;

// 'commute'=通勤手段で絞る(値は「車」等)。'hasLicense'=運転免許証の有無で絞る(値は「あり」固定を想定)
export type DocCondition = { type: 'commute' | 'hasLicense'; value: string };

export type DocType = {
  key: string;
  label: string;
  requiresOriginal?: boolean;
  pdfAllowed?: boolean;
  sensitive?: boolean;
  condition?: DocCondition;
  companies?: string[]; // 空/未指定なら全社共通。指定した法人の内定者にのみ提出を求める
  description?: string;
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
    key: 'guarantor', label: '身元保証書', requiresOriginal: true,
    description: '内定者本人と保証人が記入する書類です。必ずボールペンで記入してください。保証人の印鑑証明書もあわせて提出してください（捺印した印鑑と印鑑証明が同じものかご確認ください）。未成年の方は保護者欄への記入も必要です。まずは写真で提出いただき、原本は別途郵送・持参をお願いします。'
  },
  {
    key: 'bank', label: '給与振込先届',
    description: '給与の振込先を確認するための書類です。通帳のコピーなど、口座名義・口座番号・支店名がわかるものを提出してください。'
  },
  {
    key: 'myNumber', label: 'マイナンバー確認書類', sensitive: true,
    description: 'マイナンバーカード（両面）、またはマイナンバー通知カード＋本人確認書類の写しを提出してください。'
  },
  {
    key: 'residence', label: '住民票',
    description: '「住民票」ではなく「住民票謄本」（世帯全員が記載されたもの。ひとり暮らしの場合はご本人のみで可）を提出してください。3ヶ月以内に取得したものが必要です。役所の窓口のほか、マイナンバーカードがあればコンビニのマルチコピー機でも取得できます。引っ越しの予定がある場合は、住所変更後に取得してください。'
  },
  {
    key: 'health', label: '健康診断書', pdfAllowed: true,
    description: '学校や職場で受診した直近1年以内のものを提出してください。1年以上受診していない場合は病院での受診が必要です（検査項目は「入社時に必要な検査項目」とお伝えください）。会社負担での受診を希望する場合は事前にご連絡ください。個人名でインボイス対応の領収書が必要です。'
  },
  {
    key: 'withholding', label: '源泉徴収票（前職分）', pdfAllowed: true,
    description: '前職やアルバイト先がある方が対象です。入社年の1月から入社前月までの期間に働いていた分を提出してください（その期間に就業していない場合は提出不要です）。複数の勤務先がある場合は、勤務先ごとに提出してください。ヒューベストグループ内でのアルバイト分は会社側で確認できるため提出不要です。'
  },
  {
    key: 'graduationCertificate', label: '卒業証明書', pdfAllowed: true,
    description: '卒業した学校が発行する「卒業証明書」を提出してください（高校卒業の方は「卒業証書」のコピーでも構いません）。学校の窓口や証明書発行システムで取得できます。'
  },
  {
    key: 'carRegistration', label: '車検証の写し', condition: { type: 'commute', value: '車' },
    description: '車で通勤される方が対象です。通勤に使用する車の車検証を提出してください。',
    jinjerCustomMenuId: '3', jinjerCustomItemId: '2', jinjerRecordCode: 'auto'
  },
  {
    key: 'carInsurance', label: '自動車保険証券の写し', condition: { type: 'commute', value: '車' },
    description: '車で通勤される方が対象です。通勤に使用する車の自動車保険証券（契約内容がわかるもの。保険契約書とは異なりますのでご注意ください）を提出してください。',
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
    key: 'certificate1', label: '資格証明書（1）', optional: true,
    description: 'お持ちの資格・免許があれば証明書の写しを提出してください（国家整備士資格・宅地建物取引士（宅建）など。必須ではありません。お持ちでない場合は提出不要です）。最大3件まで登録できます。',
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
    description: '自転車で通勤される方は、自転車保険（事故によるご自身のケガを補償する傷害保険と、他人への賠償に備える個人賠償責任保険がセットになったもの）への加入が条件です。加入済みの場合は保険証券を、未加入の場合は加入手続き後に証券を提出してください。ご家族の自動車保険の特約で対応できる場合もあるため、迷ったら総務課にご相談ください。'
  },
  {
    key: 'leaseContract', label: '賃貸借契約書の写し', companies: ['佐賀バルーナーズ'],
    description: '入社時の住所で、ご本人名義の賃貸借契約がある方が対象です。契約書の写しを提出してください（ご本人名義の契約がない場合は提出不要です）。'
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
};

export type DocStatusMap = Record<string, { status?: string }>;

export function docMeta(key: string, docTypes: DocType[] = DOC_TYPES): DocType | null {
  return docTypes.find((d) => d.key === key) ?? null;
}

// employeeはEmployees行相当(Company/Commute/HasLicenseはこの綴りのプロパティ名)を想定。
// 配属先(companies)・通勤手段・運転免許証の有無(condition)は独立した軸なので、すべての条件を満たす場合のみ対象とする。
export function isApplicable(doc: DocType, employee: EmployeeLike): boolean {
  if (doc.companies && doc.companies.length > 0 && !doc.companies.includes(employee.Company || '')) return false;
  if (doc.condition) {
    if (doc.condition.type === 'commute') return employee.Commute === doc.condition.value;
    if (doc.condition.type === 'hasLicense') return employee.HasLicense === doc.condition.value;
  }
  return true;
}

export function applicableDocTypes(employee: EmployeeLike, docTypes: DocType[] = DOC_TYPES): DocType[] {
  return docTypes.filter((d) => isApplicable(d, employee));
}

// 進捗率・完了判定(受入準備完了かどうか)の対象となる書類。資格証明書のような任意(optional)の書類は、
// 未提出(NONE)のままなら対象から除外する(持っていない人がずっと「未提出」のまま止まってしまうのを防ぐ)。
// 提出済みになった場合は通常の書類と同じ扱いに戻り、承認されるまでは完了とみなさない。
function relevantDocTypes(employee: EmployeeLike, docsByKey: DocStatusMap, docTypes: DocType[]): DocType[] {
  return applicableDocTypes(employee, docTypes).filter(
    (d) => !d.optional || (docsByKey[d.key]?.status || STATUS.NONE) !== STATUS.NONE
  );
}

export function computeStage(employee: EmployeeLike, docsByKey: DocStatusMap, docTypes: DocType[] = DOC_TYPES): string {
  const applicable = relevantDocTypes(employee, docsByKey, docTypes);
  const statuses = applicable.map((d) => docsByKey[d.key]?.status || STATUS.NONE);

  if (statuses.includes(STATUS.REJECTED)) return '差し戻し';

  const others = applicable.filter((d) => d.key !== 'guarantor');
  const othersApproved = others.every((d) => (docsByKey[d.key]?.status || STATUS.NONE) === STATUS.APPROVED);
  const guarantorStatus = docsByKey.guarantor?.status || STATUS.NONE;
  if (othersApproved && guarantorStatus === STATUS.ORIGINAL_WAIT) return '原本待ち';

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
