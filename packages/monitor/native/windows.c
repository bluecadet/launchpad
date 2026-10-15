#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <node_api.h>
#include <math.h>
#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#if NAPI_VERSION != 8
#error This addon must target Node-API 8
#endif

/* No HWND or JS references survive between calls. A PID guards against reuse by
 * another process; reuse within the same process is inherently undetectable. */
typedef struct {
    HWND handle;
    DWORD process_id;
} window_identity;

typedef struct {
    window_identity *windows;
    size_t length;
    size_t capacity;
    BOOL out_of_memory;
} window_snapshot;

typedef enum { ACTION_HIDE, ACTION_MINIMIZE, ACTION_FOREGROUND } window_action;

typedef struct {
    window_identity window;
    window_action action;
    napi_async_work work;
    napi_deferred deferred;
    napi_ref failure;
} action_work;

/* Never replace a JS exception raised by a descriptor getter (or by Node-API). */
static bool check_status(napi_env env, napi_status status) {
    if (status == napi_ok) return true;
    bool pending = false;
    if (napi_is_exception_pending(env, &pending) != napi_ok) return false;
    if (!pending && napi_throw_error(env, "ERR_WINDOW_NATIVE", "Node-API operation failed") != napi_ok) return false;
    return false;
}

static bool invalid_argument(napi_env env, const char *message) {
    if (napi_throw_type_error(env, "ERR_INVALID_ARG_VALUE", message) != napi_ok) return false;
    return false;
}

static napi_value allocation_failure(napi_env env) {
    if (napi_throw_error(env, "ERR_NO_MEMORY", "Unable to allocate window data") != napi_ok) return NULL;
    return NULL;
}

static bool read_identity(napi_env env, napi_value value, window_identity *result) {
    napi_valuetype type;
    bool is_array;
    if (!check_status(env, napi_typeof(env, value, &type))) return false;
    if (type != napi_object) return invalid_argument(env, "window must be a non-null object");
    napi_value null_value;
    bool is_null;
    if (!check_status(env, napi_get_null(env, &null_value)) ||
        !check_status(env, napi_strict_equals(env, value, null_value, &is_null)) ||
        !check_status(env, napi_is_array(env, value, &is_array))) return false;
    if (is_null || is_array) return invalid_argument(env, "window must be a non-null, non-array object");

    napi_value id;
    if (!check_status(env, napi_get_named_property(env, value, "id", &id)) ||
        !check_status(env, napi_typeof(env, id, &type))) return false;
    if (type != napi_string) return invalid_argument(env, "window.id must be a decimal HWND string");

    /* UINT_PTR is at most 20 decimal digits on our 64-bit targets. Query the
     * actual UTF-8 length before copying so embedded NULs/truncation cannot pass. */
    char digits[3 * sizeof(UINT_PTR) + 1];
    size_t length;
    if (!check_status(env, napi_get_value_string_utf8(env, id, NULL, 0, &length))) return false;
    if (length == 0 || length >= sizeof(digits)) return invalid_argument(env, "window.id is not a valid HWND");
    size_t copied;
    if (!check_status(env, napi_get_value_string_utf8(env, id, digits, sizeof(digits), &copied))) return false;
    if (copied != length || digits[0] < '1' || digits[0] > '9') return invalid_argument(env, "window.id is not a valid HWND");
    UINT_PTR handle = 0;
    for (size_t index = 0; index < length; ++index) {
        if (digits[index] < '0' || digits[index] > '9') return invalid_argument(env, "window.id is not a valid HWND");
        UINT_PTR digit = (UINT_PTR)(digits[index] - '0');
        if (handle > (UINTPTR_MAX - digit) / 10) return invalid_argument(env, "window.id exceeds UINT_PTR");
        handle = handle * 10 + digit;
    }

    napi_value pid;
    double process_id;
    if (!check_status(env, napi_get_named_property(env, value, "processId", &pid)) ||
        !check_status(env, napi_typeof(env, pid, &type))) return false;
    if (type != napi_number) return invalid_argument(env, "window.processId must be a positive DWORD integer");
    if (!check_status(env, napi_get_value_double(env, pid, &process_id))) return false;
    if (!isfinite(process_id) || process_id < 1 || process_id > UINT32_MAX || floor(process_id) != process_id) {
        return invalid_argument(env, "window.processId must be a positive DWORD integer");
    }
    result->handle = (HWND)handle;
    result->process_id = (DWORD)process_id;
    return true;
}

static bool read_action(napi_env env, napi_value value, window_action *result) {
    napi_valuetype type;
    if (!check_status(env, napi_typeof(env, value, &type))) return false;
    if (type != napi_string) return invalid_argument(env, "action must be hide, minimize, or foreground");
    size_t length;
    char action[11];
    if (!check_status(env, napi_get_value_string_utf8(env, value, NULL, 0, &length))) return false;
    if (length >= sizeof(action)) return invalid_argument(env, "action must be hide, minimize, or foreground");
    size_t copied;
    if (!check_status(env, napi_get_value_string_utf8(env, value, action, sizeof(action), &copied))) return false;
    if (copied == 4 && length == 4 && memcmp(action, "hide", 4) == 0) *result = ACTION_HIDE;
    else if (copied == 8 && length == 8 && memcmp(action, "minimize", 8) == 0) *result = ACTION_MINIMIZE;
    else if (copied == 10 && length == 10 && memcmp(action, "foreground", 10) == 0) *result = ACTION_FOREGROUND;
    else return invalid_argument(env, "action must be hide, minimize, or foreground");
    return true;
}

static bool is_same_window(window_identity window) {
    DWORD process_id = 0;
    return IsWindow(window.handle) &&
        GetWindowThreadProcessId(window.handle, &process_id) != 0 &&
        process_id == window.process_id;
}

static BOOL CALLBACK collect_window(HWND handle, LPARAM parameter) {
    window_snapshot *snapshot = (window_snapshot *)parameter;
    DWORD process_id = 0;
    if (!IsWindowVisible(handle) || GetWindowThreadProcessId(handle, &process_id) == 0 || process_id == 0) return TRUE;
    if (snapshot->length == snapshot->capacity) {
        size_t capacity = snapshot->capacity == 0 ? 32 : snapshot->capacity * 2;
        if (capacity < snapshot->capacity || capacity > UINT32_MAX || capacity > SIZE_MAX / sizeof(window_identity)) {
            snapshot->out_of_memory = TRUE;
            return FALSE;
        }
        window_identity *windows = realloc(snapshot->windows, capacity * sizeof(window_identity));
        if (windows == NULL) {
            snapshot->out_of_memory = TRUE;
            return FALSE;
        }
        snapshot->windows = windows;
        snapshot->capacity = capacity;
    }
    snapshot->windows[snapshot->length++] = (window_identity){handle, process_id};
    return TRUE;
}

static bool create_identity(napi_env env, window_identity window, napi_value *result) {
    /* Format without passing a pointer through a JS number. */
    char digits[3 * sizeof(UINT_PTR) + 1];
    size_t end = sizeof(digits);
    size_t start = end;
    UINT_PTR handle = (UINT_PTR)window.handle;
    do {
        digits[--start] = (char)('0' + handle % 10);
        handle /= 10;
    } while (handle != 0);
    napi_value id, process_id;
    return check_status(env, napi_create_object(env, result)) &&
        check_status(env, napi_create_string_utf8(env, digits + start, end - start, &id)) &&
        check_status(env, napi_create_uint32(env, window.process_id, &process_id)) &&
        check_status(env, napi_set_named_property(env, *result, "id", id)) &&
        check_status(env, napi_set_named_property(env, *result, "processId", process_id));
}

static napi_value list_visible_windows(napi_env env, napi_callback_info info) {
    (void)info;
    window_snapshot snapshot = {0};
    SetLastError(ERROR_SUCCESS);
    BOOL enumerated = EnumWindows(collect_window, (LPARAM)&snapshot);
    if (snapshot.out_of_memory) {
        free(snapshot.windows);
        return allocation_failure(env);
    }
    if (!enumerated) {
        free(snapshot.windows);
        if (napi_throw_error(env, "ERR_WINDOW_ENUMERATION", "EnumWindows failed") != napi_ok) return NULL;
        return NULL;
    }
    napi_value result;
    if (!check_status(env, napi_create_array_with_length(env, snapshot.length, &result))) {
        free(snapshot.windows);
        return NULL;
    }
    for (size_t index = 0; index < snapshot.length; ++index) {
        napi_value window;
        if (!create_identity(env, snapshot.windows[index], &window) ||
            !check_status(env, napi_set_element(env, result, (uint32_t)index, window))) {
            free(snapshot.windows);
            return NULL;
        }
    }
    free(snapshot.windows);
    return result;
}

static napi_value get_window_title(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    window_identity window;
    if (!check_status(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL))) return NULL;
    if (argc != 1) {
        invalid_argument(env, "getWindowTitle requires a window");
        return NULL;
    }
    if (!read_identity(env, argv[0], &window)) return NULL;
    napi_value result;
    if (!is_same_window(window)) {
        if (!check_status(env, napi_create_string_utf8(env, "", 0, &result))) return NULL;
        return result;
    }
    int length = GetWindowTextLengthW(window.handle);
    if (length <= 0) {
        if (!check_status(env, napi_create_string_utf8(env, "", 0, &result))) return NULL;
        return result;
    }
    /* GetWindowTextW accepts a signed int, including space for its terminator. */
    if (length == INT_MAX || (size_t)length + 1 > SIZE_MAX / sizeof(WCHAR)) return allocation_failure(env);
    WCHAR *title = calloc((size_t)length + 1, sizeof(WCHAR));
    if (title == NULL) return allocation_failure(env);
    int copied = GetWindowTextW(window.handle, title, length + 1);
    if (copied < 0 || !is_same_window(window)) copied = 0;
    bool created = check_status(env, napi_create_string_utf16(env, (const char16_t *)title, (size_t)copied, &result));
    free(title);
    return created ? result : NULL;
}

/* All code in this callback is Win32/C only: no Node-API or JS access.
 * ShowWindow and the legacy focus sequence may wait on an unresponsive target.
 * This deliberately uses the libuv worker pool, not a semantic-changing timeout
 * or ShowWindowAsync substitute. Enough hung targets can exhaust that pool. */
static void execute_action(napi_env env, void *data) {
    (void)env;
    action_work *state = data;
    if (!is_same_window(state->window)) return;
    HWND handle = state->window.handle;
    if (state->action == ACTION_HIDE) {
        ShowWindow(handle, SW_HIDE); /* Return value is previous visibility. */
        return;
    }
    if (state->action == ACTION_MINIMIZE) {
        ShowWindow(handle, SW_MINIMIZE);
        return;
    }

    /* Preserve node-window-manager's installed focus behavior: do not restore a
     * minimized window. Windows may deny focus; its BOOLs are not guarantees. */
    SetForegroundWindow(handle);
    if (!is_same_window(state->window)) return;
    HWND foreground = GetForegroundWindow();
    DWORD worker_thread = GetCurrentThreadId();
    DWORD foreground_thread = GetWindowThreadProcessId(foreground, NULL);
    MSG message;
    PeekMessageW(&message, NULL, 0, 0, PM_NOREMOVE); /* Ensure this worker has a queue. */
    BOOL attached = AttachThreadInput(foreground_thread, worker_thread, TRUE);
    /* A blocking call can let the target disappear and its HWND be reused.
     * Recheck before each later target operation; the final check/use race is
     * unavoidable in Win32. Every stale exit must still detach our input queue. */
    if (!is_same_window(state->window)) goto detach;
    SetWindowPos(handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE);
    if (!is_same_window(state->window)) goto detach;
    SetWindowPos(handle, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE);
    if (!is_same_window(state->window)) goto detach;
    SetForegroundWindow(handle);
detach:
    if (attached) AttachThreadInput(foreground_thread, worker_thread, FALSE);
    if (!is_same_window(state->window)) return;
    SetFocus(handle);
    if (!is_same_window(state->window)) return;
    SetActiveWindow(handle);
}

/* Use a preallocated error so native allocation/queue failures can reject
 * without allocating another JS error while already out of memory. */
static void reject_action(napi_env env, napi_deferred deferred, napi_value fallback) {
    bool pending;
    napi_value reason = fallback;
    if (!check_status(env, napi_is_exception_pending(env, &pending))) return;
    if (pending && !check_status(env, napi_get_and_clear_last_exception(env, &reason))) return;
    /* A failed reference lookup normally leaves an exception. If the runtime
     * supplied none, still settle the promise rather than passing a NULL handle. */
    if (reason == NULL && !check_status(env, napi_get_undefined(env, &reason))) return;
    check_status(env, napi_reject_deferred(env, deferred, reason));
}

static void complete_action(napi_env env, napi_status status, void *data) {
    action_work *state = data;
    napi_deferred deferred = state->deferred;
    napi_value failure = NULL;
    bool got_failure = check_status(env, napi_get_reference_value(env, state->failure, &failure));
    bool deleted_work = check_status(env, napi_delete_async_work(env, state->work));
    bool deleted_failure = check_status(env, napi_delete_reference(env, state->failure));
    free(state);
    if (!got_failure || status != napi_ok || !deleted_work || !deleted_failure) {
        reject_action(env, deferred, failure);
        return;
    }
    napi_value undefined;
    if (!check_status(env, napi_get_undefined(env, &undefined))) {
        reject_action(env, deferred, failure);
        return;
    }
    if (!check_status(env, napi_resolve_deferred(env, deferred, undefined))) reject_action(env, deferred, failure);
}

static napi_value apply_window_action(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value argv[2];
    window_identity window;
    window_action action;
    if (!check_status(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL))) return NULL;
    if (argc != 2) {
        invalid_argument(env, "applyWindowAction requires a window and action");
        return NULL;
    }
    if (!read_identity(env, argv[0], &window) || !read_action(env, argv[1], &action)) return NULL;

    napi_value message, failure, promise;
    napi_deferred deferred;
    if (!check_status(env, napi_create_string_utf8(env, "Unable to run window action", NAPI_AUTO_LENGTH, &message)) ||
        !check_status(env, napi_create_error(env, NULL, message, &failure)) ||
        !check_status(env, napi_create_promise(env, &deferred, &promise))) return NULL;
    action_work *state = calloc(1, sizeof(action_work));
    if (state == NULL) {
        reject_action(env, deferred, failure);
        return promise;
    }
    state->window = window;
    state->action = action;
    state->deferred = deferred;
    napi_status referenced = napi_create_reference(env, failure, 1, &state->failure);
    if (referenced != napi_ok) {
        free(state);
        reject_action(env, deferred, failure);
        return promise;
    }
    napi_status created = napi_create_async_work(env, NULL, message, execute_action, complete_action, state, &state->work);
    if (created != napi_ok) {
        check_status(env, napi_delete_reference(env, state->failure));
        free(state);
        reject_action(env, deferred, failure);
        return promise;
    }
    napi_status queued = napi_queue_async_work(env, state->work);
    if (queued != napi_ok) {
        check_status(env, napi_delete_async_work(env, state->work));
        check_status(env, napi_delete_reference(env, state->failure));
        free(state);
        reject_action(env, deferred, failure);
    }
    return promise;
}

NAPI_MODULE_INIT() {
    const napi_property_descriptor methods[] = {
        {"listVisibleWindows", NULL, list_visible_windows, NULL, NULL, NULL, napi_default, NULL},
        {"getWindowTitle", NULL, get_window_title, NULL, NULL, NULL, napi_default, NULL},
        {"applyWindowAction", NULL, apply_window_action, NULL, NULL, NULL, napi_default, NULL},
    };
    if (!check_status(env, napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods))) return NULL;
    return exports;
}
