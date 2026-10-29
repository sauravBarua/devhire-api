export interface EmailLinks {
  job: (jobId: string) => string;
  recruiterJob: (jobId: string) => string;
  recruiterApplications: (jobId: string) => string;
  search: (filters: unknown) => string;
}

// the web app routes are defined in Part B; adjust them here in one place
export function buildLinks(webUrl: string): EmailLinks {
  const base = webUrl.replace(/\/+$/, '');
  return {
    job: (jobId) => `${base}/jobs/${jobId}`,
    recruiterJob: (jobId) => `${base}/recruiter/jobs/${jobId}`,
    recruiterApplications: (jobId) =>
      `${base}/recruiter/jobs/${jobId}/applications`,
    search: (filters) => {
      const params = new URLSearchParams();
      if (typeof filters === 'object' && filters !== null) {
        for (const [key, value] of Object.entries(
          filters as Record<string, unknown>,
        )) {
          const text: unknown = Array.isArray(value) ? value.join(',') : value;
          if (
            text === '' ||
            (typeof text !== 'string' && typeof text !== 'number')
          )
            continue;
          params.set(key, String(text));
        }
      }
      const query = params.toString();
      return query ? `${base}/jobs?${query}` : `${base}/jobs`;
    },
  };
}
