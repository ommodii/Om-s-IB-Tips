const SUPABASE_URL = 'https://vlrrsyxfrrppukqyzfay.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZscnJzeXhmcnJwcHVrcXl6ZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MzY4NDEsImV4cCI6MjA5MTUxMjg0MX0.LLGFEIItes4CNgtfznsCvHBhlyIfZEMY9iBoqH4qlZE';

let supabaseClient = null;
let currentUser = null;

if (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.supabaseClient = supabaseClient; // Expose globally

    // Call getSession explicitly to ensure URL fragment is parsed
    supabaseClient.auth.getSession().then(({ data: { session }, error }) => {
        if (error) console.error("Auth session error:", error);
        currentUser = session?.user || null;
        window.currentUser = currentUser;
        
        if (currentUser && typeof window.syncFromSupabase === 'function') {
            window.syncFromSupabase(currentUser.id);
        }

        updateAuthUI();

        // Clean up the URL hash if it contains auth info
        if (window.location.hash && window.location.hash.includes('access_token')) {
            window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
            document.getElementById('auth-modal')?.classList.add('hidden');
        }
    });

    supabaseClient.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user || null;
        window.currentUser = currentUser;
        
        if (currentUser && event === 'SIGNED_IN' && typeof window.syncFromSupabase === 'function') {
            window.syncFromSupabase(currentUser.id);
        }

        updateAuthUI();
        if (event === 'SIGNED_IN') {
            document.getElementById('auth-modal')?.classList.add('hidden');
        }
    });
} else {
    console.warn("Supabase credentials missing. Authentication features are disabled.");
}

async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
}

function updateAuthUI() {
    const desktopBtn = document.getElementById('account-toggle-desktop');
    const mobileBtn = document.getElementById('account-toggle-mobile');

    const authStatusDiv = document.getElementById('auth-status');
    const authFormDiv = document.getElementById('auth-form-container');
    const userEmailSpan = document.getElementById('auth-user-email');

    if (currentUser) {
        if (desktopBtn) desktopBtn.querySelector('span').textContent = "Account";
        if (authStatusDiv) authStatusDiv.classList.remove('hidden');
        if (authFormDiv) authFormDiv.classList.add('hidden');
        if (userEmailSpan) userEmailSpan.textContent = currentUser.email;
    } else {
        if (desktopBtn) desktopBtn.querySelector('span').textContent = "Sign In";
        if (authStatusDiv) authStatusDiv.classList.add('hidden');
        if (authFormDiv) authFormDiv.classList.remove('hidden');
        if (userEmailSpan) userEmailSpan.textContent = '';
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById('auth-modal');
    const closeBtn = document.getElementById('btn-close-auth');
    const googleBtn = document.getElementById('btn-google-login');
    const errorBox = document.getElementById('auth-error');

    document.getElementById('account-toggle-desktop')?.addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('account-toggle-mobile')?.addEventListener('click', () => modal.classList.remove('hidden'));

    closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));

    document.getElementById('btn-signout')?.addEventListener('click', async () => {
        await signOut();
    });
    googleBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        errorBox.classList.add('hidden');
        googleBtn.disabled = true;

        if (!supabaseClient) {
            errorBox.textContent = "Supabase not configured.";
            errorBox.classList.remove('hidden');
            googleBtn.disabled = false;
            return;
        }

        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin
            }
        });

        if (error) {
            errorBox.textContent = error.message;
            errorBox.classList.remove('hidden');
            googleBtn.disabled = false;
        }
    });

    updateAuthUI();
});
