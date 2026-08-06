// auth.js — UI helpers for login page

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  } else {
    input.type = "password";
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
}

function showReset() {
  document.getElementById("login-form").style.display = "none";
  document.getElementById("reset-form").style.display = "block";
  clearMessages();
}

function showLogin() {
  document.getElementById("reset-form").style.display = "none";
  document.getElementById("login-form").style.display = "block";
  clearMessages();
}

function showError(msg) {
  const el = document.getElementById("error-box");
  el.textContent = msg;
  el.style.display = "block";
  document.getElementById("success-box").style.display = "none";
}

function showSuccess(msg) {
  const el = document.getElementById("success-box");
  el.textContent = msg;
  el.style.display = "block";
  document.getElementById("error-box").style.display = "none";
}

function clearMessages() {
  document.getElementById("error-box").style.display = "none";
  document.getElementById("success-box").style.display = "none";
}

function setLoading(btn, loading, text) {
  btn.disabled = loading;
  btn.querySelector("span").textContent = text;
}

function friendlyError(code) {
  const map = {
    "auth/user-not-found": "No account found with that email address.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
    "auth/user-disabled": "This account has been disabled. Contact your administrator.",
    "auth/network-request-failed": "Network error. Check your internet connection.",
    "auth/invalid-credential": "Incorrect email or password. Please try again."
  };
  return map[code] || "Something went wrong. Please try again.";
}
