import { describe, expect, it } from 'vitest';

import { compileInline, render } from '@/services/templates.js';

describe('compileInline', () => {
  it('renders Handlebars variables', () => {
    const result = compileInline('Hello {{name}}', { name: 'Alice' });
    expect(result).toBe('Hello Alice');
  });

  it('handles missing vars without throwing', () => {
    const result = compileInline('Hello {{name}}', {});
    expect(result).toBe('Hello ');
  });

  it('handles nested object access', () => {
    const result = compileInline('Plan: {{plan.code}}', { plan: { code: 'vip_monthly' } });
    expect(result).toBe('Plan: vip_monthly');
  });

  it('formatCents helper renders currency', () => {
    const result = compileInline('{{formatCents amount currency}}', {
      amount: 1499,
      currency: 'USD',
    });
    expect(result).toMatch(/\$14\.99/);
  });
});

describe('render for in_app channel', () => {
  it('produces body_text with no HTML', () => {
    const out = render({
      channel: 'in_app',
      subject_template: 'You have a reply on "{{thread_title}}"',
      body_source: '{{author}} replied: {{snippet}}',
      body_compiled: null,
      variables: {
        thread_title: 'CVE-2026-0001 walkthrough',
        author: 'Bob',
        snippet: 'great approach',
      },
    });
    expect(out.subject).toBe('You have a reply on "CVE-2026-0001 walkthrough"');
    expect(out.body_text).toBe('Bob replied: great approach');
    expect(out.body_html).toBeNull();
  });
});
