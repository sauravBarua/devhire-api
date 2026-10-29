import { describe, expect, it } from 'vitest';
import { buildLinks } from './email-links';
import {
  escapeHtml,
  expiryReminderEmail,
  formatDateFr,
  newApplicationEmail,
  searchAlertEmail,
  type AlertJobItem,
} from './email-templates';

const job = (overrides: Partial<AlertJobItem> = {}): AlertJobItem => ({
  title: 'Développeur Node.js',
  companyName: 'Société Alpha',
  city: 'Paris',
  contractType: 'CDI',
  url: 'http://localhost:3001/jobs/abc',
  ...overrides,
});

describe('escapeHtml', () => {
  it('escapes the dangerous characters', () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });
});

describe('searchAlertEmail', () => {
  const base = {
    firstName: 'Alice',
    searchName: 'Node remote',
    extraCount: 0,
    searchUrl: 'http://x/jobs?q=node',
  };

  it('uses the singular for one job', () => {
    const mail = searchAlertEmail({ ...base, jobs: [job()] });
    expect(mail.subject).toBe('Nouvelle offre pour « Node remote »');
    expect(mail.html).toContain('1 nouvelle offre correspond');
    expect(mail.text).toContain(
      '- Développeur Node.js (Société Alpha · Paris · CDI) http://localhost:3001/jobs/abc',
    );
  });

  it('uses the plural and counts extra jobs in the total', () => {
    const mail = searchAlertEmail({
      ...base,
      jobs: [job(), job({ title: 'Autre' })],
      extraCount: 3,
    });
    expect(mail.subject).toBe('5 nouvelles offres pour « Node remote »');
    expect(mail.html).toContain('et 3 autres offres');
    expect(mail.text).toContain('... et 3 autres offres.');
  });

  it('escapes user-controlled content in the HTML and keeps the subject on one line', () => {
    const mail = searchAlertEmail({
      ...base,
      searchName: 'Evil\r\nBcc: x@y.z',
      jobs: [
        job({
          title: 'Dev <script>alert(1)</script>',
          url: 'http://x/jobs?a=1&b=2',
        }),
      ],
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('Dev &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('http://x/jobs?a=1&amp;b=2');
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('omits missing parts of the job details', () => {
    const mail = searchAlertEmail({ ...base, jobs: [job({ city: null })] });
    expect(mail.text).toContain('(Société Alpha · CDI)');
  });
});

describe('expiryReminderEmail', () => {
  const base = {
    firstName: 'Robert',
    jobTitle: 'Développeur NestJS',
    expiresAt: new Date('2026-11-05T12:00:00Z'),
    manageUrl: 'http://localhost:3001/recruiter/jobs/abc',
  };

  it('mentions the days left, the date and the renewal option', () => {
    const mail = expiryReminderEmail({ ...base, daysLeft: 3 });
    expect(mail.subject).toBe(
      'Votre offre « Développeur NestJS » expire dans 3 jours',
    );
    expect(mail.html).toContain('5 novembre 2026');
    expect(mail.text).toContain('renouveler');
    expect(mail.text).toContain(base.manageUrl);
  });

  it('uses the singular for one day', () => {
    expect(expiryReminderEmail({ ...base, daysLeft: 1 }).subject).toContain(
      'expire dans 1 jour',
    );
    expect(expiryReminderEmail({ ...base, daysLeft: 1 }).subject).not.toContain(
      'jours',
    );
  });
});

describe('newApplicationEmail', () => {
  it('names the candidate and the job and links to the applications', () => {
    const mail = newApplicationEmail({
      firstName: 'Robert',
      candidateName: 'Alice <b>Martin</b>',
      jobTitle: 'Développeur NestJS',
      applicationsUrl: 'http://localhost:3001/recruiter/jobs/abc/applications',
    });
    expect(mail.subject).toBe(
      'Nouvelle candidature pour « Développeur NestJS »',
    );
    expect(mail.html).toContain('Alice &lt;b&gt;Martin&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Martin');
    expect(mail.text).toContain('/recruiter/jobs/abc/applications');
  });
});

describe('formatDateFr', () => {
  it('formats in French', () => {
    expect(formatDateFr(new Date('2026-01-15T10:00:00Z'))).toBe(
      '15 janvier 2026',
    );
  });
});

describe('buildLinks', () => {
  const links = buildLinks('http://localhost:3001/');

  it('builds job links without a double slash', () => {
    expect(links.job('abc')).toBe('http://localhost:3001/jobs/abc');
    expect(links.recruiterApplications('abc')).toBe(
      'http://localhost:3001/recruiter/jobs/abc/applications',
    );
  });

  it('builds a search link from stored filters', () => {
    const url = links.search({
      q: 'node.js',
      category: ['BACKEND', 'FULLSTACK'],
      salaryMin: 40000,
      empty: '',
      nothing: undefined,
    });
    expect(url).toBe(
      'http://localhost:3001/jobs?q=node.js&category=BACKEND%2CFULLSTACK&salaryMin=40000',
    );
  });

  it('falls back to the plain search page', () => {
    expect(links.search({})).toBe('http://localhost:3001/jobs');
    expect(links.search(null)).toBe('http://localhost:3001/jobs');
  });
});
