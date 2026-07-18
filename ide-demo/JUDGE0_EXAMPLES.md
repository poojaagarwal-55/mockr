# Judge0 Example Payloads
## 1. POST Submission Request (Multi-TestCase Batch)
**URL**: `POST https://judge0-ce.p.rapidapi.com/submissions/batch?base64_encoded=true`
**Headers**:
- `Content-Type: application/json`
- `x-rapidapi-host: judge0-ce.p.rapidapi.com`
- `x-rapidapi-key: <YOUR_API_KEY>`
**Request Body** (Example with 2 tests):
```json
{
  "submissions": [
    {
      "source_code": "ZnVuY3Rpb24gdHdvU3VtKG51bXMsIHRhcmdldCkgewogIHJldHVybiBbMCwgMV07Cn0KY29uc29sZS5sb2codHdvU3VtKFsyLDcsMTEsMTVdLCA5KSk7",
      "language_id": 93,
      "stdin": "WzIsNywxMSwxNV0Kcw==",
      "expected_output": "WzAsMV0=",
      "cpu_time_limit": 2,
      "memory_limit": 262144,
      "max_output_size": 131072,
      "enable_network": false,
      "callback_url": "https://your-ngrok-url.app/api/ide/judge0-callback"
    },
    {
      "source_code": "ZnVuY3Rpb24gdHdvU3VtKG51bXMsIHRhcmdldCkgewogIHJldHVybiBbMCwgMV07Cn0KY29uc29sZS5sb2codHdvU3VtKFsyLDcsMTEsMTVdLCA5KSk7",
      "language_id": 93,
      "stdin": "WzMsMiw0XQo2",
      "expected_output": "WzEsMl0=",
      "cpu_time_limit": 2,
      "memory_limit": 262144,
      "max_output_size": 131072,
      "enable_network": false,
      "callback_url": "https://your-ngrok-url.app/api/ide/judge0-callback"
    }
  ]
}
```
## 2. POST Submission Response (Synchronous Acknowledgement)
**Response Body (Status 201 Created)**:
```json
[
  {
    "token": "a1b2c3d4-0000-1111-2222-333344445555"
  },
  {
    "token": "e5f6g7h8-0000-1111-2222-333344445555"
  }
]
```
*Note: We store these tokens mapped to our internal `test_id` so we know which webhook belongs to which test.*
---
## 3. Webhook Payload sent by Judge0 (Base64 Encoded)
**URL**: `PUT /api/ide/judge0-callback`
**Request Body (sent to your server by Judge0)**:
```json
{
  "source_code": "ZnVuY3Rpb24gdHdvU3VtKG51bXMsIHRhcmdldCkgewogIHJldHVybiBbMCwgMV07Cn0KY29uc29sZS5sb2codHdvU3VtKFsyLDcsMTEsMTVdLCA5KSk7",
  "language_id": 93,
  "stdin": "WzIsNywxMSwxNV0Kcw==",
  "expected_output": "WzAsMV0=",
  "stdout": "WzAsIDFdCg==",
  "status_id": 3,
  "created_at": "2026-03-16T08:31:05.123Z",
  "finished_at": "2026-03-16T08:31:05.541Z",
  "time": "0.061",
  "memory": 8192,
  "stderr": null,
  "token": "a1b2c3d4-0000-1111-2222-333344445555",
  "number_of_runs": 1,
  "cpu_time_limit": "2.0",
  "cpu_extra_time": "1.0",
  "wall_time_limit": "10.0",
  "memory_limit": 262144,
  "stack_limit": 65536,
  "max_processes_and_or_threads": 60,
  "enable_per_process_and_thread_time_limit": false,
  "enable_per_process_and_thread_memory_limit": false,
  "max_file_size": 1024,
  "compile_output": null,
  "exit_code": 0,
  "exit_signal": null,
  "message": null,
  "wall_time": "0.124",
  "compiler_options": null,
  "command_line_arguments": null,
  "redirect_stderr_to_stdout": false,
  "callback_url": "https://your-ngrok-url.app/api/ide/judge0-callback",
  "enable_network": false,
  "status": {
    "id": 3,
    "description": "Accepted"
  }
}
```
*Note: You must Base64 decode `stdout`, `stderr`, and `compile_output` when displaying them in your UI.*