let currentUser = null;
let authToken = localStorage.getItem('coinrise_token');

document.addEventListener('DOMContentLoaded', () => {
    if (authToken) {
        fetchProfile();
    } else {
        showAuthView();
    }
});

function toggleAuthView(view) {
    if (view === 'signup') {
        document.getElementById('login-form-view').style.display = 'none';
        document.getElementById('signup-form-view').style.display = 'block';
    } else {
        document.getElementById('signup-form-view').style.display = 'none';
        document.getElementById('login-form-view').style.display = 'block';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');
    errEl.innerText = '';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        authToken = data.token;
        localStorage.setItem('coinrise_token', authToken);
        currentUser = data.user;
        initApp();
    } catch (err) {
        errEl.innerText = err.message;
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const referralCode = document.getElementById('signupRefCode').value;
    const errEl = document.getElementById('signupError');
    errEl.innerText = '';

    try {
        const res = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, referralCode })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Signup failed');

        authToken = data.token;
        localStorage.setItem('coinrise_token', authToken);
        currentUser = data.user;
        initApp();
    } catch (err) {
        errEl.innerText = err.message;
    }
}

async function fetchProfile() {
    try {
        const res = await fetch('/api/user/profile', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (!res.ok) throw new Error('Session expired');
        const data = await res.json();
        currentUser = data.user;
        initApp();
    } catch (err) {
        logout();
    }
}

function initApp() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-wrapper').style.display = 'block';

    document.getElementById('headerPoints').innerText = currentUser.points.toLocaleString();
    document.getElementById('walletPointsNum').innerText = currentUser.points.toLocaleString();
    document.getElementById('walletValueNum').innerText = (currentUser.points / 100).toFixed(2);
    document.getElementById('welcomeUserTitle').innerText = `Hello, ${currentUser.name}`;
    document.getElementById('profileName').innerText = currentUser.name;
    document.getElementById('profileEmail').innerText = currentUser.email;
    document.getElementById('profileRefCode').innerText = currentUser.referralCode;
    document.getElementById('uniqueRefCode').innerText = currentUser.referralCode;
    document.getElementById('headerAvatar').innerText = currentUser.name.charAt(0).toUpperCase();
    document.getElementById('profileInitials').innerText = currentUser.name.charAt(0).toUpperCase();

    if (currentUser.isAdmin) {
        document.getElementById('adminBanner').style.display = 'block';
        document.getElementById('adminMenuBtn').style.display = 'flex';
    }

    loadTasks();
    loadTransactions();
    loadReferrals();
    switchSection('home');
}

function logout() {
    localStorage.removeItem('coinrise_token');
    authToken = null;
    currentUser = null;
    document.getElementById('app-wrapper').style.display = 'none';
    document.getElementById('auth-container').style.display = 'flex';
}

function showAuthView() {
    document.getElementById('auth-container').style.display = 'flex';
    document.getElementById('app-wrapper').style.display = 'none';
}

function switchSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.bottom-nav .nav-item').forEach(nav => nav.classList.remove('active'));

    const targetSec = document.getElementById(sectionId + '-section');
    if (targetSec) targetSec.classList.add('active');

    const targetNav = document.getElementById('nav-' + sectionId);
    if (targetNav) targetNav.classList.add('active');

    if (sectionId === 'admin' && currentUser && currentUser.isAdmin) {
        loadAdminUsers();
        loadAdminTasks();
        loadAdminWithdrawals();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadTasks() {
    try {
        const res = await fetch('/api/tasks', { headers: { 'Authorization': 'Bearer ' + authToken } });
        const tasks = await res.json();
        
        const homeList = document.getElementById('homeTaskList');
        const earnList = document.getElementById('earnTaskList');
        homeList.innerHTML = '';
        earnList.innerHTML = '';

        tasks.slice(0, 3).forEach(t => homeList.innerHTML += createTaskHTML(t));
        tasks.forEach(t => earnList.innerHTML += createTaskHTML(t));
    } catch (e) {
        console.error(e);
    }
}

function createTaskHTML(t) {
    return `
        <div class="task-card">
            <div class="tc-left">
                <div class="tc-icon"><i class="fa-solid fa-bolt"></i></div>
                <div class="tc-info">
                    <h4>${t.title}</h4>
                    <p>${t.description} • <span class="gold-icon"><i class="fa-solid fa-star"></i> +${t.reward_points} pts</span></p>
                </div>
            </div>
            <button class="btn-primary" ${t.completed ? 'disabled' : ''} onclick="completeTask(${t.id})">
                ${t.completed ? 'Completed' : 'Complete'}
            </button>
        </div>
    `;
}

async function completeTask(taskId) {
    try {
        const res = await fetch('/api/tasks/complete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ taskId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to complete task');

        currentUser.points = data.newBalance;
        showToast(`Earned +${data.earned} points successfully!`);
        initApp();
    } catch (e) {
        showToast(e.message);
    }
}

async function loadTransactions() {
    try {
        const res = await fetch('/api/user/profile', { headers: { 'Authorization': 'Bearer ' + authToken } });
        const data = await res.json();
        const container = document.getElementById('transactionListContainer');
        container.innerHTML = '';
        data.transactions.forEach(tx => {
            const isPos = tx.points > 0;
            container.innerHTML += `
                <div class="tx-card">
                    <div class="tc-left">
                        <div class="tc-icon" style="background: ${isPos ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'}; color: ${isPos ? '#10b981' : '#ef4444'};">
                            <i class="fa-solid ${isPos ? 'fa-arrow-down' : 'fa-arrow-up'}"></i>
                        </div>
                        <div class="tc-info">
                            <h4>${tx.title}</h4>
                            <p>${tx.created_at} • <span>${tx.status}</span></p>
                        </div>
                    </div>
                    <div style="font-weight: 700; color: ${isPos ? '#10b981' : '#ef4444'};">
                        ${isPos ? '+' : ''}${tx.points} pts
                    </div>
                </div>
            `;
        });
    } catch (e) {}
}

async function loadReferrals() {
    try {
        const res = await fetch('/api/referrals', { headers: { 'Authorization': 'Bearer ' + authToken } });
        const refs = await res.json();
        const container = document.getElementById('referredListContainer');
        container.innerHTML = '';
        document.getElementById('refCount').innerText = refs.length;
        refs.forEach(r => {
            container.innerHTML += `
                <div class="ref-card">
                    <div class="tc-left">
                        <div class="tc-icon" style="background: rgba(236, 72, 153, 0.15); color: #ec4899;"><i class="fa-solid fa-user"></i></div>
                        <div class="tc-info">
                            <h4>${r.referred_name}</h4>
                            <p>Joined: ${r.created_at}</p>
                        </div>
                    </div>
                    <div class="gold-icon" style="font-weight: 700;">+${r.points_earned} pts</div>
                </div>
            `;
        });
    } catch (e) {}
}

function openWithdrawModal() {
    document.getElementById('withdrawModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

async function submitWithdrawal() {
    const upiId = document.getElementById('withdrawUpi').value.trim();
    const amount = parseInt(document.getElementById('withdrawAmount').value) || 0;
    const errEl = document.getElementById('withdrawError');
    errEl.innerText = '';

    try {
        const res = await fetch('/api/wallet/withdraw', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ upiId, amount })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Withdrawal failed');

        currentUser.points = data.newBalance;
        closeModal('withdrawModal');
        showToast('Withdrawal request submitted for verification.');
        initApp();
    } catch (e) {
        errEl.innerText = e.message;
    }
}

function copyRefCode() {
    navigator.clipboard.writeText(currentUser.referralCode);
    showToast('Referral code copied!');
}

function showToast(msg) {
    const toast = document.getElementById('toastNotification');
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Admin Functions
function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tabs .chip').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');

    document.getElementById('adminUsersTab').style.display = tab === 'users' ? 'block' : 'none';
    document.getElementById('adminTasksTab').style.display = tab === 'tasks' ? 'block' : 'none';
    document.getElementById('adminWithdrawalsTab').style.display = tab === 'withdrawals' ? 'block' : 'none';
}

async function loadAdminUsers() {
    const res = await fetch('/api/admin/users', { headers: { 'Authorization': 'Bearer ' + authToken } });
    const users = await res.json();
    const container = document.getElementById('adminUsersTab');
    container.innerHTML = users.map(u => `
        <div class="task-card" style="margin-bottom: 8px;">
            <div>
                <h4>${u.name} ${u.is_admin ? '(Admin)' : ''}</h4>
                <p>${u.email} • Points: ${u.points} • Status: ${u.is_suspended ? 'Suspended' : 'Active'}</p>
            </div>
            <button class="btn-primary" style="background: ${u.is_suspended ? '#10b981' : '#ef4444'};" onclick="toggleSuspend(${u.id})">
                ${u.is_suspended ? 'Unsuspend' : 'Suspend'}
            </button>
        </div>
    `).join('');
}

async function toggleSuspend(userId) {
    await fetch(`/api/admin/users/${userId}/suspend`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + authToken }
    });
    loadAdminUsers();
}

async function loadAdminTasks() {
    const res = await fetch('/api/admin/tasks', { headers: { 'Authorization': 'Bearer ' + authToken } });
    const tasks = await res.json();
    const container = document.getElementById('adminTasksList');
    container.innerHTML = tasks.map(t => `
        <div class="task-card" style="margin-bottom: 8px;">
            <div>
                <h4>${t.title}</h4>
                <p>${t.description} • Reward: +${t.reward_points}</p>
            </div>
        </div>
    `).join('');
}

async function createTask() {
    const title = document.getElementById('newTaskTitle').value;
    const description = document.getElementById('newTaskDesc').value;
    const rewardPoints = parseInt(document.getElementById('newTaskReward').value);

    await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken
        },
        body: JSON.stringify({ title, description, rewardPoints })
    });
    document.getElementById('newTaskTitle').value = '';
    document.getElementById('newTaskDesc').value = '';
    document.getElementById('newTaskReward').value = '';
    loadAdminTasks();
    showToast('Task created successfully!');
}

async function loadAdminWithdrawals() {
    const res = await fetch('/api/admin/withdrawals', { headers: { 'Authorization': 'Bearer ' + authToken } });
    const withdrawals = await res.json();
    const container = document.getElementById('adminWithdrawalsList');
    container.innerHTML = withdrawals.map(w => `
        <div class="task-card" style="margin-bottom: 8px; flex-direction: column; align-items: flex-start;">
            <div style="width: 100%; display: flex; justify-content: space-between;">
                <h4>User ID: ${w.user_id} (${w.user_name})</h4>
                <span style="font-weight: bold; color: ${w.status === 'Paid' ? '#10b981' : '#f59e0b'}">${w.status}</span>
            </div>
            <p>UPI: <strong>${w.upi_id}</strong> • Amount: <strong>${w.amount} pts</strong></p>
            <div style="display: flex; gap: 8px; margin-top: 10px;">
                <button class="btn-primary" onclick="updateWithdrawal(${w.id}, 'Approved')">Approve</button>
                <button class="btn-primary" style="background: #10b981;" onclick="updateWithdrawal(${w.id}, 'Paid')">Mark Paid</button>
                <button class="btn-primary" style="background: #ef4444;" onclick="updateWithdrawal(${w.id}, 'Rejected')">Reject</button>
            </div>
        </div>
    `).join('');
}

async function updateWithdrawal(id, status) {
    await fetch(`/api/admin/withdrawals/${id}/status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + authToken
        },
        body: JSON.stringify({ status })
    });
    loadAdminWithdrawals();
    showToast(`Withdrawal marked as ${status}`);
}
