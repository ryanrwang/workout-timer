<?php
header('Content-Type: application/json');

$DATA_DIR = __DIR__ . '/data/users/';
$COOKIE_NAME = 'wt_token';
$COOKIE_DAYS = 365;

// Ensure data directory exists
if (!is_dir($DATA_DIR)) {
    mkdir($DATA_DIR, 0755, true);
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Helper: validate token format (hex only, 32 chars)
function validToken($token) {
    return preg_match('/^[a-f0-9]{32}$/', $token);
}

// Helper: get user file path
function userFile($token) {
    global $DATA_DIR;
    if (!validToken($token)) return false;
    return $DATA_DIR . $token . '.json';
}

// Helper: read user file with shared lock
function readUser($token) {
    $file = userFile($token);
    if (!$file || !file_exists($file)) return false;
    $fp = fopen($file, 'r');
    if (!$fp) return false;
    flock($fp, LOCK_SH);
    $content = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return json_decode($content, true);
}

// Helper: write user file with exclusive lock
function writeUser($token, $userData) {
    $file = userFile($token);
    if (!$file) return false;
    $fp = fopen($file, 'c');
    if (!$fp) return false;
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($userData, JSON_PRETTY_PRINT));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return true;
}

// Helper: detect if connection is HTTPS (handles proxies)
function isSecure() {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') return true;
    if (!empty($_SERVER['HTTP_X_FORWARDED_SSL']) && $_SERVER['HTTP_X_FORWARDED_SSL'] === 'on') return true;
    if (isset($_SERVER['SERVER_PORT']) && $_SERVER['SERVER_PORT'] == 443) return true;
    return false;
}

// Helper: set auth cookie
function setTokenCookie($token) {
    global $COOKIE_NAME, $COOKIE_DAYS;
    setcookie($COOKIE_NAME, $token, [
        'expires' => time() + ($COOKIE_DAYS * 86400),
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => isSecure()
    ]);
}

// Helper: get token from cookie, Authorization header, or query param (fallback chain)
function getTokenFromCookie() {
    global $COOKIE_NAME;
    // 1. Try cookie first
    $token = $_COOKIE[$COOKIE_NAME] ?? null;
    if ($token && validToken($token)) return $token;
    // 2. Fallback: Bearer token from Authorization header
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+([a-f0-9]{32})$/', $auth, $m)) {
        return $m[1];
    }
    // 3. Fallback: token query parameter (for sendBeacon which can't set headers)
    $qtoken = $_GET['token'] ?? null;
    if ($qtoken && validToken($qtoken)) return $qtoken;
    return null;
}

// Helper: send JSON response
function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

// --- ROUTES ---

switch ($action) {

    // Register a new user
    case 'register':
        if ($method !== 'POST') respond(['error' => 'POST required'], 405);

        $input = json_decode(file_get_contents('php://input'), true);
        $name = trim($input['name'] ?? '');
        $pin = $input['pin'] ?? '';

        if ($name === '' || strlen($name) > 50) {
            respond(['error' => 'Name required (max 50 chars)'], 400);
        }
        if (strlen($pin) < 4) {
            respond(['error' => 'PIN must be at least 4 characters'], 400);
        }

        // Generate unique token
        $token = bin2hex(random_bytes(16));

        $userData = [
            'name' => $name,
            'pin_hash' => password_hash($pin, PASSWORD_BCRYPT),
            'created' => date('c'),
            'data' => null
        ];

        if (!writeUser($token, $userData)) {
            respond(['error' => 'Failed to create user'], 500);
        }

        setTokenCookie($token);
        respond(['token' => $token, 'name' => $name]);
        break;

    // Login with token + PIN (for new devices)
    case 'login':
        if ($method !== 'POST') respond(['error' => 'POST required'], 405);

        $input = json_decode(file_get_contents('php://input'), true);
        $token = $input['token'] ?? '';
        $pin = $input['pin'] ?? '';

        if (!validToken($token)) {
            respond(['error' => 'Invalid token'], 400);
        }

        $user = readUser($token);
        if (!$user) {
            respond(['error' => 'User not found'], 404);
        }

        if (!password_verify($pin, $user['pin_hash'])) {
            respond(['error' => 'Wrong PIN'], 403);
        }

        setTokenCookie($token);
        respond(['name' => $user['name']]);
        break;

    // Check if current cookie is valid
    case 'check':
        $token = getTokenFromCookie();
        if (!$token || !validToken($token)) {
            respond(['error' => 'Not authenticated'], 401);
        }

        $user = readUser($token);
        if (!$user) {
            respond(['error' => 'User not found'], 404);
        }

        respond(['name' => $user['name'], 'token' => $token]);
        break;

    // Save user data
    case 'save':
        if ($method !== 'POST') respond(['error' => 'POST required'], 405);

        $token = getTokenFromCookie();
        if (!$token || !validToken($token)) {
            respond(['error' => 'Not authenticated'], 401);
        }

        $user = readUser($token);
        if (!$user) {
            respond(['error' => 'User not found'], 404);
        }

        $input = json_decode(file_get_contents('php://input'), true);
        if ($input === null) {
            respond(['error' => 'Invalid JSON body'], 400);
        }

        $user['data'] = $input;

        if (!writeUser($token, $user)) {
            respond(['error' => 'Failed to save'], 500);
        }

        respond(['ok' => true]);
        break;

    // Load user data
    case 'load':
        $token = getTokenFromCookie();
        if (!$token || !validToken($token)) {
            respond(['error' => 'Not authenticated'], 401);
        }

        $user = readUser($token);
        if (!$user) {
            respond(['error' => 'User not found'], 404);
        }

        respond(['name' => $user['name'], 'data' => $user['data']]);
        break;

    // Logout (clear cookie)
    case 'logout':
        setcookie('wt_token', '', [
            'expires' => time() - 86400,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => isSecure()
        ]);
        respond(['ok' => true]);
        break;

    default:
        respond(['error' => 'Unknown action'], 400);
}
