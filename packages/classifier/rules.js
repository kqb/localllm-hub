/**
 * Rule-based email classifier
 * Ported from ~/Projects/emailctl/lib/classifier.js
 */

const rules = {
  junk: [
    { type: 'fromDomain', patterns: ['marketing.', 'promo.', 'notifications@'] },
    { type: 'subject', regex: /\b(unsubscribe|opt.out)\b/i },
    { type: 'label', value: 'SPAM' }
  ],

  subscriptions: [
    { type: 'fromDomain', patterns: ['newsletter', 'updates@', 'noreply@'] },
    { type: 'subject', regex: /newsletter|digest|weekly|monthly/i },
    { type: 'body', keywords: ['unsubscribe', 'manage preferences'] }
  ],

  bills: [
    { type: 'subject', regex: /invoice|receipt|payment|bill|statement/i },
    { type: 'fromDomain', patterns: ['billing@', 'invoices@', 'payments@'] },
    { type: 'body', keywords: ['amount due', 'payment received'] }
  ],

  jobs: [
    { type: 'subject', regex: /job|career|position|interview|application/i },
    { type: 'fromDomain', patterns: ['jobs@', 'careers@', 'linkedin.com', 'indeed.com'] }
  ],

  shopping: [
    { type: 'subject', regex: /order|shipping|delivery|tracking|cart/i },
    { type: 'fromDomain', patterns: ['amazon.', 'ebay.', 'shopify.', 'shop@'] },
    { type: 'label', value: 'CATEGORY_PROMOTIONS' }
  ],

  travel: [
    { type: 'subject', regex: /flight|booking|reservation|hotel|trip/i },
    { type: 'fromDomain', patterns: ['airbnb.', 'booking.', 'expedia.', 'airline'] }
  ],

  finance: [
    { type: 'subject', regex: /account|transaction|balance|credit|debit/i },
    { type: 'fromDomain', patterns: ['bank', 'paypal.', 'venmo.', 'stripe.'] }
  ],

  health: [
    { type: 'subject', regex: /appointment|prescription|medical|health|doctor/i },
    { type: 'fromDomain', patterns: ['health', 'medical', 'pharmacy'] }
  ],

  newsletters: [
    { type: 'label', value: 'CATEGORY_UPDATES' },
    { type: 'subject', regex: /edition|issue #|this week|today in/i }
  ],

  notifications: [
    { type: 'subject', regex: /alert|notification|reminder|confirm/i },
    { type: 'fromDomain', patterns: ['notifications@', 'alerts@', 'no-reply@'] }
  ],

  personal: [
    { type: 'label', value: 'CATEGORY_PERSONAL' }
  ],

  legal: [
    { type: 'subject', regex: /terms|privacy|policy|legal|agreement/i },
    { type: 'fromDomain', patterns: ['legal@', 'compliance@'] }
  ]
};

const categoryOrder = [
  'junk', 'bills', 'jobs', 'finance', 'health', 'legal',
  'travel', 'shopping', 'subscriptions', 'newsletters',
  'notifications', 'personal'
];

function matchesRule(email, rule) {
  switch (rule.type) {
    case 'fromDomain':
      return rule.patterns.some(pattern =>
        email.from.toLowerCase().includes(pattern.toLowerCase())
      );

    case 'subject':
      return rule.regex.test(email.subject);

    case 'body':
      if (!email.body) return false;
      return rule.keywords.some(keyword =>
        email.body.toLowerCase().includes(keyword.toLowerCase())
      );

    case 'label':
      return email.labels && email.labels.includes(rule.value);

    default:
      return false;
  }
}

function matchesCategory(email, category) {
  const categoryRules = rules[category];
  if (!categoryRules) return false;

  for (const rule of categoryRules) {
    if (matchesRule(email, rule)) {
      return true;
    }
  }
  return false;
}

function classify(email) {
  for (const category of categoryOrder) {
    if (matchesCategory(email, category)) {
      return category;
    }
  }
  return null;
}

module.exports = { classify, rules, categoryOrder };
