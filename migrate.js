const fs = require('fs');
const csv = require('csv-parser');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'san_bartolome_library',
    password: 'postgres', 
    port: 5432,
});

async function migrate() {
    const results = [];
    const defaultPassword = await bcrypt.hash('123456', 10);
    const today = '2026-04-01'; // Fallback date if Column D is empty

    fs.createReadStream('data.csv')
        .pipe(csv(['full_name', 'time_in_raw', 'time_out_raw', 'date']))
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            console.log(`CSV Loaded. Importing ${results.length} students...`);

            for (let i = 0; i < results.length; i++) {
                const row = results[i];
                if (!row.full_name || row.full_name.trim().toUpperCase() === 'NAME') continue;

                const libraryId = `LIB-2026-${i.toString().padStart(3, '0')}`;

                try {
                    // 1. Create the Member
                    const memberRes = await pool.query(
                        `INSERT INTO members (full_name, library_id, password_hash) 
                         VALUES ($1, $2, $3) RETURNING id`,
                        [row.full_name.trim(), libraryId, defaultPassword]
                    );
                    const memberId = memberRes.rows[0].id;

                    // 2. Format the Timestamps correctly
                    // We trim the space and combine Date + Time
                    const dateVal = (row.date && row.date.trim()) ? row.date.trim() : today;
                    const tIn = row.time_in_raw.trim();
                    const tOut = (row.time_out_raw && row.time_out_raw.trim()) ? row.time_out_raw.trim() : null;

                    const timestampIn = `${dateVal} ${tIn}`;
                    const timestampOut = tOut ? `${dateVal} ${tOut}` : null;

                    // 3. Insert into Attendance Table
                    await pool.query(
                        `INSERT INTO attendance (member_id, time_in, time_out) 
                         VALUES ($1, $2, $3)`,
                        [memberId, timestampIn, timestampOut]
                    );

                    console.log(`✅ Success: ${row.full_name.trim()} (${libraryId})`);
                } catch (err) {
                    console.error(`❌ Error with ${row.full_name}:`, err.message);
                    // This tells us if row.date was empty
                    console.log(`   Debug info -> Date: "${row.date}", TimeIn: "${row.time_in_raw}"`);
                }
            }
            console.log('--- Migration Finished! ---');
            process.exit();
        });
}

migrate();