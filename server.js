const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
require('dotenv').config();

const app = express();

// --- MIDDLEWARE ---
app.use(express.json());
// CORS allows your HTML files to talk to this server from a different URL/Domain
app.use(cors());

// --- DATABASE CONNECTION ---
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'san_bartolome_library',
    password: 'postgres', 
    port: 5432,
});

// --- ROOT ROUTE ---
// This fixes the "Cannot GET /" error when visiting the tunnel link directly
app.get('/', (req, res) => {
    res.send("🚀 San Bartolome Library Server is Live and Connected!");
});

// --- DYNAMIC ID PREVIEW ---
app.get('/next-id', async (req, res) => {
    try {
        const currentYear = new Date().getFullYear(); 
        const result = await pool.query(
            "SELECT COUNT(*) FROM members WHERE library_id LIKE $1",
            [`LIB-${currentYear}-%`]
        );
        const count = parseInt(result.rows[0].count);
        const nextNum = count + 1;
        const formattedId = `LIB-${currentYear}-${String(nextNum).padStart(3, '0')}`;
        res.json({ nextId: formattedId });
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

// --- REGISTRATION ---
app.post('/register', async (req, res) => {
    const { full_name, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await pool.query(
            `INSERT INTO members (full_name, library_id, password_hash) 
             VALUES ($1, 'LIB-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || 
             LPAD((SELECT COUNT(*) + 1 FROM members WHERE library_id LIKE 'LIB-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-%')::text, 3, '0'), $2) 
             RETURNING library_id`, [full_name, hashedPassword]
        );
        res.status(201).json({ message: 'Registered!', library_id: newUser.rows[0].library_id });
    } catch (err) { res.status(500).json({ message: "Registration failed." }); }
});

// --- LOGIN (WITH BAN CHECK) ---
app.post('/login', async (req, res) => {
    const { library_id, password } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM members WHERE library_id = $1', [library_id]);
        if (userRes.rows.length === 0) return res.status(400).json({ message: 'User not found' });
        const user = userRes.rows[0];
        if (user.is_banned) return res.status(403).json({ message: 'Access Denied.' });
        const validPass = await bcrypt.compare(password, user.password_hash);
        if (!validPass) return res.status(400).json({ message: 'Incorrect password' });
        const attendance = await pool.query('INSERT INTO attendance (member_id) VALUES ($1) RETURNING id, time_in', [user.id]);
        res.json({ 
            user: { 
                id: user.id, 
                full_name: user.full_name, 
                library_id: user.library_id, 
                is_admin: user.is_admin 
            }, 
            log_id: attendance.rows[0].id, 
            time_in: attendance.rows[0].time_in 
        });
    } catch (err) { res.status(500).json({ message: "Login Error" }); }
});

// --- LOGOUT ---
app.post('/logout', async (req, res) => {
    const { log_id } = req.body;
    try {
        const result = await pool.query(`UPDATE attendance SET time_out = CURRENT_TIMESTAMP, duration_minutes = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - time_in))/60 WHERE id = $1 RETURNING *`, [log_id]);
        res.json({ message: 'Logged out!', log: result.rows[0] });
    } catch (err) { res.status(500).json({ message: "Logout Error" }); }
});

// --- ADMIN: BOOK MANAGEMENT ---
app.get('/admin/books', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM books ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Failed to fetch books" }); }
});

app.post('/admin/books', async (req, res) => {
    const { title, author } = req.body;
    try {
        const result = await pool.query('INSERT INTO books (title, author) VALUES ($1, $2) RETURNING *', [title, author]);
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: "Failed to add book" }); }
});

app.delete('/admin/books/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM books WHERE id = $1', [req.params.id]);
        res.json({ message: "Book deleted" });
    } catch (err) { res.status(500).json({ error: "Failed to delete book" }); }
});

// --- ADMIN: MEMBER & ATTENDANCE ---
app.get('/admin/members', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, full_name, library_id, is_admin, is_banned, created_at FROM members ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.patch('/admin/members/:id/ban', async (req, res) => {
    try {
        await pool.query('UPDATE members SET is_banned = $1 WHERE id = $2', [req.body.is_banned, req.params.id]);
        res.json({ message: "Status updated" });
    } catch (err) { res.status(500).json({ message: "Error" }); }
});

app.get('/admin/attendance', async (req, res) => {
    try {
        const result = await pool.query(`SELECT a.*, m.full_name, m.library_id FROM attendance a JOIN members m ON a.member_id = m.id ORDER BY a.time_in DESC`);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ message: "Error" }); }
});

// --- 🖥️ COMPUTER STATION LOGIC ---

app.get('/pc/status', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.*, m.full_name 
            FROM computer_status c 
            LEFT JOIN members m ON c.current_user_id = m.id 
            ORDER BY c.id ASC LIMIT 1`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: "PC Fetch Error" }); }
});

app.post('/pc/borrow', async (req, res) => {
    try {
        await pool.query(
            `UPDATE computer_status SET is_occupied = true, current_user_id = $1, start_time = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM computer_status ORDER BY id ASC LIMIT 1)`, 
            [req.body.user_id]
        );
        res.json({ message: "PC Borrowed" });
    } catch (err) { res.status(500).json({ error: "Borrow Error" }); }
});

app.post('/pc/release', async (req, res) => {
    try {
        await pool.query(`UPDATE computer_status SET is_occupied = false, current_user_id = NULL, start_time = NULL WHERE id = (SELECT id FROM computer_status ORDER BY id ASC LIMIT 1)`);
        res.json({ message: "PC Released" });
    } catch (err) { res.status(500).json({ error: "Release Error" }); }
});

// --- SERVER START ---
const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Library Server running on http://localhost:${PORT}`));