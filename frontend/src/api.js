// The only door to the backend. Maps API contracts to the shapes the prototype UI already uses.
async function readBody(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`);
  return body;
}

const request = async (path, init) => readBody(await fetch(path, init));

const HUMAN_KEY = 'triple-firma-human-key';

function readHumanKey() {
  try { return sessionStorage.getItem(HUMAN_KEY) || ''; } catch { return ''; }
}

function storeHumanKey(key) {
  try { sessionStorage.setItem(HUMAN_KEY, key); } catch { /* private mode: asked again next time */ }
}

// Approvals and rule changes need the approval key (x-api-key). It is asked only when the backend
// answers 401, kept for this browser tab, and never built into the bundle.
async function requestAsHuman(path, init) {
  const send = key => fetch(path, { ...init, headers: { ...init.headers, 'x-api-key': key } });
  let response = await send(readHumanKey());
  if (response.status === 401) {
    const key = window.prompt('Clave de aprobación');
    if (!key) throw new Error('Se necesita la clave de aprobación');
    response = await send(key);
    if (response.status === 401) throw new Error('Clave de aprobación incorrecta');
    storeHumanKey(key);
  }
  return readBody(response);
}

const DECISION_BY_STATUS = { PAYABLE: 'pay', BLOCKED: 'blocked', PENDING_APPROVAL: 'approval', REJECTED: 'rejected' };
const CHECK_BY_OUTCOME = { PASS: 'pass', BLOCK: 'fail', ESCALATE: 'review' };

const initials = name => name.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();

function toInvoice(record) {
  const { invoice, decision, approval } = record;
  const { extraction } = invoice;
  const payee = extraction.payee.value || 'Beneficiario no legible';
  const minor = decision.baseAmountMinor ?? 0; // USD, as the screens show it
  const checks = decision.ruleResults.map(r => ({ label: r.ruleId, status: CHECK_BY_OUTCOME[r.outcome], detail: r.message }));
  return {
    id: extraction.reference.value || record.fileName,
    decisionId: decision.id,
    vendor: payee, beneficiary: payee, initials: initials(payee),
    category: invoice.sourceFormat,
    amount: minor / 100, // display only
    currency: decision.currency || 'USD',
    due: extraction.dueDate.value || '—', date: extraction.issueDate.value || '—',
    description: record.fileName,
    decision: DECISION_BY_STATUS[record.status],
    reason: approval ? `${approval.approver}: ${approval.comment}` : decision.explanation,
    reasons: checks.filter(c => c.status !== 'pass').map(c => c.detail),
    checks, finalStatus: null
  };
}

export const loadInvoices = async () => (await request('/api/decisions')).map(toInvoice);

export const uploadInvoice = async file => {
  const form = new FormData();
  form.append('file', file);
  return toInvoice(await request('/api/invoices', { method: 'POST', body: form }));
};

export const resolveApproval = async (decisionId, action, approver, comment) =>
  toInvoice(await requestAsHuman(`/api/approvals/${encodeURIComponent(decisionId)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, approver, comment })
  }));

const toRules = ({ config }) => ({
  maxPerInvoice: (config.hardCapMinor ?? 0) / 100,
  monthlyBudget: config.monthlyBudgetMinor / 100,
  requireApprovalAbove: config.approvalThresholdMinor / 100,
  allowedVendors: config.allowedPayees.join(', '),
  // ponytail: the backend always runs every rule; these two toggles are UI-only
  blockDuplicates: true, blockUnknownVendors: true
});

export const loadRules = async () => {
  const current = await request('/api/config');
  return { rules: toRules(current), config: current.config };
};

// Saves a new version, keeping the config fields the form does not edit.
export const saveRules = async (rules, config) => {
  const next = {
    ...config,
    hardCapMinor: rules.maxPerInvoice > 0 ? Math.round(rules.maxPerInvoice * 100) : null,
    monthlyBudgetMinor: Math.round(rules.monthlyBudget * 100),
    approvalThresholdMinor: Math.round(rules.requireApprovalAbove * 100),
    allowedPayees: rules.allowedVendors.split(',').map(v => v.trim()).filter(Boolean)
  };
  const saved = await requestAsHuman('/api/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
  return { rules: toRules(saved), config: saved.config };
};
