export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface AlertJobItem {
  title: string;
  companyName: string;
  city: string | null;
  contractType: string;
  url: string;
}

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeZone: 'Europe/Paris',
});

export const formatDateFr = (date: Date): string => dateFormatter.format(date);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// subjects are headers: no line breaks allowed
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();
const plural = (count: number, one: string, many: string): string =>
  count === 1 ? one : many;

function layout(heading: string, body: string): string {
  return (
    '<!doctype html><html lang="fr"><body style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:16px">' +
    `<h2 style="margin:0 0 16px">${escapeHtml(heading)}</h2>${body}` +
    '<p style="color:#6b7280;font-size:12px;margin-top:32px">DevHire - emploi web et tech</p>' +
    '</body></html>'
  );
}

const button = (url: string, label: string): string =>
  `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>`;

export function searchAlertEmail(input: {
  firstName: string;
  searchName: string;
  jobs: AlertJobItem[];
  extraCount: number;
  searchUrl: string;
}): EmailContent {
  const total = input.jobs.length + input.extraCount;
  const searchName = oneLine(input.searchName);
  const subject =
    total === 1
      ? `Nouvelle offre pour « ${searchName} »`
      : `${total} nouvelles offres pour « ${searchName} »`;

  const details = (job: AlertJobItem): string =>
    [job.companyName, job.city, job.contractType]
      .filter((part): part is string => Boolean(part))
      .join(' · ');

  const intro = `${total} ${plural(total, 'nouvelle offre correspond', 'nouvelles offres correspondent')} à votre recherche enregistrée « ${searchName} »`;
  const items = input.jobs
    .map(
      (job) =>
        `<li style="margin-bottom:8px"><a href="${escapeHtml(job.url)}">${escapeHtml(job.title)}</a><br><span style="color:#6b7280">${escapeHtml(details(job))}</span></li>`,
    )
    .join('');
  const extraHtml =
    input.extraCount > 0
      ? `<p>et ${input.extraCount} ${plural(input.extraCount, 'autre offre', 'autres offres')}.</p>`
      : '';

  const html = layout(
    subject,
    `<p>Bonjour ${escapeHtml(input.firstName)},</p><p>${escapeHtml(intro)} :</p><ul>${items}</ul>${extraHtml}${button(input.searchUrl, 'Voir toutes les offres')}`,
  );
  const text = [
    `Bonjour ${input.firstName},`,
    '',
    `${intro} :`,
    ...input.jobs.map((job) => `- ${job.title} (${details(job)}) ${job.url}`),
    ...(input.extraCount > 0
      ? [
          `... et ${input.extraCount} ${plural(input.extraCount, 'autre offre', 'autres offres')}.`,
        ]
      : []),
    '',
    `Voir toutes les offres : ${input.searchUrl}`,
  ].join('\n');

  return { subject, html, text };
}

export function expiryReminderEmail(input: {
  firstName: string;
  jobTitle: string;
  expiresAt: Date;
  daysLeft: number;
  manageUrl: string;
}): EmailContent {
  const title = oneLine(input.jobTitle);
  const days = `${input.daysLeft} ${plural(input.daysLeft, 'jour', 'jours')}`;
  const subject = `Votre offre « ${title} » expire dans ${days}`;
  const date = formatDateFr(input.expiresAt);
  const message = `Votre offre « ${title} » expirera le ${date}. Passé ce délai, elle ne sera plus visible dans les résultats de recherche, mais vous pourrez la renouveler depuis votre espace recruteur.`;

  const html = layout(
    subject,
    `<p>Bonjour ${escapeHtml(input.firstName)},</p><p>${escapeHtml(message)}</p>${button(input.manageUrl, "Gérer l'offre")}`,
  );
  const text = [
    `Bonjour ${input.firstName},`,
    '',
    message,
    '',
    `Gérer l'offre : ${input.manageUrl}`,
  ].join('\n');
  return { subject, html, text };
}

export function newApplicationEmail(input: {
  firstName: string;
  candidateName: string;
  jobTitle: string;
  applicationsUrl: string;
}): EmailContent {
  const title = oneLine(input.jobTitle);
  const subject = `Nouvelle candidature pour « ${title} »`;
  const message = `${oneLine(input.candidateName)} vient de postuler à votre offre « ${title} ».`;

  const html = layout(
    subject,
    `<p>Bonjour ${escapeHtml(input.firstName)},</p><p>${escapeHtml(message)}</p>${button(input.applicationsUrl, 'Voir les candidatures')}`,
  );
  const text = [
    `Bonjour ${input.firstName},`,
    '',
    message,
    '',
    `Voir les candidatures : ${input.applicationsUrl}`,
  ].join('\n');
  return { subject, html, text };
}
