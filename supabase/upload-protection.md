# PDF upload and processing limits

CareFlow accepts PDFs up to 10,485,760 bytes (displayed as 10 MB).
Existing files, document rows, cases, and correction history are not rewritten.

## Application checks

- The file picker advertises PDF support.
- Before uploading, the browser checks extension, MIME type, nonempty size,
  the 10 MB limit, a PDF version header, and a trailing EOF marker.
- Validated files with an unknown/octet-stream MIME type are sent as
  application/pdf. Other declared file types are rejected.
- New storage paths use a random UUID instead of the original filename;
  the original filename remains available in the hospital's document record.
- Invalid selections do not clear an open review or create records. An open
  correction editor blocks uploads. Sign-out during validation stops submission.

## Processor checks

The processor still uses the caller's authenticated Supabase client and RLS.
It verifies case ownership and the hospital folder before asking Storage for
file info. Invalid or oversized size metadata prevents a file download.
It then checks the downloaded size, PDF header, and EOF marker before base64
encoding or any AI request. Existing revision and review safeguards remain.

These checks identify obvious wrong/truncated files; they do not parse the full
PDF structure, scan for malware, guarantee readability, or reject every hostile
document. A file containing a PDF header and EOF marker can still be invalid.

## Storage configuration required separately

The documents bucket must remain private and should enforce:

| Setting | Value |
| --- | --- |
| Public bucket | Off |
| Maximum file size | 10,485,760 bytes (10 MiB) |
| Allowed MIME types | application/pdf |

Apply these through the Supabase Dashboard or the supported Storage updateBucket
API using an authorized administrative client. Do not expose administrative
credentials to the browser. Do not directly modify Storage metadata through SQL.

The connected MCP tools do not expose updateBucket. This code release does not
claim to change bucket settings. Until those settings are saved and verified,
someone who bypasses the website can still submit other files directly to
Storage under the existing access policies and platform-wide limits. The
processor's checks still prevent those files from being sent for AI processing.

Bucket MIME and size settings are not malware scanning. Retention, quotas,
request-rate limits, file scanning, robust PDF parsing, and account security
remain separate production work. Use fictional patient information only.

## Validation

Run npm test with Node.js 24+ after npm ci --ignore-scripts. The public suite has
58 tests, including the size boundary, oversized files, contradictory MIME,
renamed and truncated input, failed Storage metadata reads, dishonest size
metadata, source-path privacy, sign-out races, and correction-editor protection.
The tests use synthetic data and a stubbed AI response; they do not certify
production JWT verification, live Storage behavior, or the actual AI response.

After deployment, refresh the website and upload the same fake patient PDF.
Confirm the upload completes and its saved case opens. Also try selecting a
non-PDF file through the file picker's All files option: it must show a clear
error without creating a case. No production file should be deleted for testing.

References:

- [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Update a bucket](https://supabase.com/docs/reference/javascript/file-buckets-updatebucket)
- [Read file info](https://supabase.com/docs/reference/javascript/file-buckets-info)
- [Storage schema guidance](https://supabase.com/docs/guides/storage/schema/design)
