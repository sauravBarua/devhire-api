// multer limits: besides the file size, cap the number and size of the other multipart parts,
// so a request cannot hold the server with thousands of fields or huge text values
export const LOGO_UPLOAD_LIMITS = {
  fileSize: 2 * 1024 * 1024,
  files: 1,
  fields: 1,
  parts: 3,
  fieldSize: 1024,
  fieldNameSize: 100,
  headerPairs: 20,
} as const;

export const CV_UPLOAD_LIMITS = {
  fileSize: 5 * 1024 * 1024,
  files: 1,
  fields: 2,
  parts: 4,
  // a 5000-character cover letter is at most 20 KB in UTF-8
  fieldSize: 32 * 1024,
  fieldNameSize: 100,
  headerPairs: 20,
} as const;
