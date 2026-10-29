export const NOTIFICATIONS_QUEUE = 'notifications';

export const NotificationJobs = {
  SearchAlert: 'search-alert',
  ExpiryReminder: 'expiry-reminder',
  NewApplication: 'new-application',
} as const;

// one job claims and sends every pending match of the saved search
export interface SearchAlertData {
  savedSearchId: string;
}

export interface ExpiryReminderData {
  jobId: string;
}

export interface NewApplicationData {
  applicationId: string;
  jobId: string;
  companyId: string;
  candidateId: string;
}
