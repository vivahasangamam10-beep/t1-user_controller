// app.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import dayjs from "dayjs";
import { Pool } from "pg";

dotenv.config();

const PORT = process.env.PORT || 4000;
const POSTGRESS_URL = process.env.POSTGRES_URL;
const API_KEY = process.env.API_KEY || "devkey";

if (!POSTGRESS_URL) {
  console.error("PG_URL / DATABASE_URL missing in env");
  if (process.env.NODE_ENV !== "production") {
    process.exit(1);
  }
}

const app = express();
app.use(express.json());

// ---------- Postgres pool ----------
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 5, // limit pool
  idleTimeoutMillis: 3000,   // close idle fast
  connectionTimeoutMillis: 5000,
});

// Optional: Verify connection at startup (non-blocking)
pool
  .connect()
  .then((c) => {
    c.release();
    console.log("Connected to Postgres");
  })
  .catch((err) => {
    console.error("Postgres connection error:", err.message);
    if (process.env.NODE_ENV !== "production") process.exit(1);
  });


const PLAN_MAP = {
  entry: { amount: 100, valid_days: 10 },
  silver: { amount: 1770, valid_days: 90 },
  gold: { amount: 2950, valid_days: 180 },
  platinum: { amount: 4720, valid_days: 365 },
};

// ---------- Utilities (date parsing & plan calculations) ----------
function parseAnyDate(value) {
  // If falsy or null -> return current date (matching your original behavior)
  if (!value) return new Date();

  if (value instanceof Date && !isNaN(value)) return value;

  // If value is already a number (timestamp)
  if (!isNaN(value) && String(value).length >= 10) {
    const num = Number(value);
    // treat as ms if big, else sec -> ms
    return new Date(num > 1e12 ? num : num * 1000);
  }

  // Try direct Date parse first
  const direct = new Date(value);
  if (!isNaN(direct)) return direct;

  // DMY pattern 01-02-2000 or 1/2/2000
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;
  if (dmy.test(value)) {
    const m = value.match(dmy);
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    const y = m[3];
    return new Date(`${y}-${mo}-${d}`);
  }

  // 1-Jan-20 or 1-Jan-2020
  const dmy2 = /^(\d{1,2})[-/](\w{3,})[-/](\d{2,4})$/i;
  if (dmy2.test(value)) {
    const m = value.match(dmy2);
    let d = m[1];
    let mon = m[2];
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    // format "1 Jan 2020"
    return new Date(`${d} ${mon} ${y}`);
  }

  // fallback
  return new Date();
}

function calculateexpiry_date(reg_date, plan) {
  const rule = PLAN_MAP[(plan || "entry").toLowerCase()] || PLAN_MAP.entry;
  const reg = parseAnyDate(reg_date);
  const expiry = new Date(reg);
  expiry.setDate(expiry.getDate() + rule.valid_days);
  return {
    expiry_date: expiry,
    amount: rule.amount,
    valid_days: rule.valid_days,
  };
}

function getplan_status(expiry_date) {
  const exp = parseAnyDate(expiry_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return exp < today ? "expired" : "active";
}

// mapping helpers: convert DB row (snake_case) -> API object (camelCase)
function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    regno: row.regno,
    name: row.name,
    gender: row.gender,
    caste: row.caste,
    caste_category: row.caste_category,
    gothram: row.gothram,
    food_habits: row.food_habits,
    reg_date: row.reg_date,
    plan: row.plan,
    amount: row.amount,
    payment_mode: row.payment_mode,
    transaction_id: row.transaction_id,
    valid_days: row.valid_days,
    expiry_date: row.expiry_date,
    plan_status: row.plan_status,
    new_or_renewal: row.new_or_renewal,
    marital_status: row.marital_status,
    dob: row.dob,
    yob: row.yob,
    age: row.age,
    time_of_birth: row.time_of_birth,
    place_of_birth: row.place_of_birth,
    height: row.height,
    weight: row.weight,
    star: row.star,
    paadham: row.paadham,
    rasi: row.rasi,
    lagnam: row.lagnam,
    dosham: row.dosham,
    education: row.education,
    ug_degree: row.ug_degree,
    ug_specialization: row.ug_specialization,
    pg_degree: row.pg_degree,
    pg_specialization: row.pg_specialization,
    occupation: row.occupation,
    annual_income: row.annual_income,
    father_name: row.father_name,
    father_occupation: row.father_occupation,
    mother_name: row.mother_name,
    mother_occupation: row.mother_occupation,
    sibling_details: row.sibling_details,
    native_place: row.native_place,
    current_residence: row.current_residence,
    address: row.address,
    city: row.city,
    pincode: row.pincode,
    state: row.state,
    country: row.country,
    ownHouse: row.ownHouse,
    property_details: row.property_details,
    expectations: row.expectations,
    remarks: row.remarks,
    flashed_date: row.flashed_date,
    renewal_date: row.renewal_date,
    renewal_amount: row.renewal_amount,
    contact1: row.contact1,
    contact2: row.contact2,
    contact3: row.contact3,
    email: row.email,
    created_by: row.created_by,
    modified_by: row.modified_by,
    deleted_by: row.deleted_by,
    is_deleted: row.is_deleted,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}


// ---------- Middleware: CORS + API Key ----------
app.use(
  cors({
    origin: [
      "https://localhost:3000",
      "https://vivahainternaltool.netlify.app",
      "https://vivahainternaltool.netlify.app/form",
      "https://vivahainternaltool.netlify.app/users",
      "https://vivahainternaltool.netlify.app/renewals",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "x-api-key"],
    credentials: true,
  })
);

app.use((req, res, next) => {
  // allow preflight through
  if (req.method === "OPTIONS") return next();

  const key = req.header("x-api-key");
  if (!key || key !== API_KEY) {
    return res.status(401).json({ message: "Unauthorized: Invalid API Key" });
  }
  next();
});

// DB check middleware (calls pool.query simple ping)
app.use(async (req, res, next) => {
  if (req.method === "OPTIONS") return next();
  try {
    // simple query to ensure pool is available
    await pool.query("SELECT 1");
    next();
  } catch (err) {
    console.error("DB connect error in middleware:", err.message);
    return res.status(503).json({ message: "DB connection unavailable" });
  }
});

// ---------- Helper: updateplan_statusInDB (given a user row) ----------
async function updateplan_statusInDB(row) {
  if (!row || !row.id) return null;
  try {
    const status = getplan_status(row.expiry_date);
    if (status !== (row.plan_status || "").toLowerCase()) {
      const q = `UPDATE t1."T1_USERS" SET plan_status = $1, updateAt = now() WHERE id = $2`;
      await pool.query(q, [status.toLowerCase(), row.id]);
    }
    return status.toLowerCase();
  } catch (err) {
    console.error("updateplan_statusInDB error:", err.message);
    return (row.plan_status || "expired").toLowerCase();
  }
}

// ---------- POST /api/users (create) ----------

app.post("/api/users", async (req, res) => {
  try {
    const body = { ...req.body };

    // -------------------- Normalize dates --------------------
    if (body.reg_date) body.reg_date = parseAnyDate(body.reg_date);
    if (body.dob) body.dob = parseAnyDate(body.dob);
    if (body.flashed_date) body.flashed_date = parseAnyDate(body.flashed_date);
    if (body.renewal_date) body.renewal_date = parseAnyDate(body.renewal_date);

    // -------------------- Plan calculation --------------------
    const plan = (body.plan || "entry").toLowerCase();
    const { expiry_date, amount, valid_days } =
      calculateexpiry_date(body.reg_date, plan);

    body.amount = amount;
    body.valid_days = valid_days;
    body.expiry_date = expiry_date;
    body.plan_status = getplan_status(expiry_date).toLowerCase();

    // -------------------- SYSTEM VALUES (FORCED) --------------------
    body.is_deleted = false;       // ✅ FORCE
    body.created_at = new Date();  // ✅ FORCE

    // -------------------- COLUMN MAP (MATCHES DB EXACTLY) --------------------
    const mapping = {
      regno: "regno",
      name: "name",
      gender: "gender",
      caste: "caste",
      caste_category: "caste_category",
      gothram: "gothram",
      food_habits: "food_habits",
      reg_date: "reg_date",
      plan: "plan",
      amount: "amount",
      payment_mode: "payment_mode",
      transaction_id: "transaction_id",
      valid_days: "valid_days",
      expiry_date: "expiry_date",
      plan_status: "plan_status",
      new_or_renewal: "new_or_renewal",
      marital_status: "marital_status",
      dob: "dob",
      yob: "yob",
      age: "age",
      time_of_birth: "time_of_birth",
      place_of_birth: "place_of_birth",
      height: "height",
      weight: "weight",
      star: "star",
      paadham: "paadham",
      rasi: "rasi",
      lagnam: "lagnam",
      dosham: "dosham",
      education: "education",
      ug_degree: "ug_degree",
      ug_specialization: "ug_specialization",
      pg_degree: "pg_degree",
      pg_specialization: "pg_specialization",
      occupation: "occupation",
      annual_income: "annual_income",
      father_name: "father_name",
      father_occupation: "father_occupation",
      mother_name: "mother_name",
      mother_occupation: "mother_occupation",
      sibling_details: "sibling_details",
      native_place: "native_place",
      current_residence: "current_residence",
      address: "address",
      city: "city",
      pincode: "pincode",
      state: "state",
      country: "country",
      own_house: "own_house",              // ✅ FIXED
      property_details: "property_details",
      expectations: "expectations",
      remarks: "remarks",
      flashed_date: "flashed_date",
      renewal_date: "renewal_date",
      renewal_amount: "renewal_amount",
      contact1: "contact1",
      contact2: "contact2",
      contact3: "contact3",
      email: "email",
      created_by: "created_by",
      is_deleted: "is_deleted",             // ✅ SYSTEM
      created_at: "created_at"              // ✅ SYSTEM
    };

    // -------------------- BUILD INSERT SAFELY --------------------
    const cols = [];
    const values = [];
    const placeholders = [];

    Object.entries(mapping).forEach(([key, col]) => {
      if (body[key] !== undefined) {
        cols.push(`"${col}"`);
        values.push(body[key]);
        placeholders.push(`$${values.length}`);
      }
    });

    if (!cols.length) {
      return res.status(400).json({ message: "No fields provided" });
    }

    const sql = `
      INSERT INTO t1."T1_USERS" (${cols.join(", ")})
      VALUES (${placeholders.join(", ")})
      RETURNING *
    `;

    const { rows } = await pool.query(sql, values);
    res.status(201).json(rowToUser(rows[0]));

  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ message: "Duplicate regno" });
    }
    console.error("POST /api/users error:", err);
    res.status(500).json({ message: err.message });
  }
});



app.get("/api/users", async (req, res) => {
  try {
    const {
      q = "",
      plan,
      food_habits,
      caste,
      yob,
      currentResidingLocation,
      gender,
      education,
      marital_status,

      gothram,
      height,
      weight,
      star,
      rasi,
      dosham,
      occupation,
      annual_income,
      dob,

      page = 1,
      limit = 100,
    } = req.query;

    const filters = [`is_deleted = false`];
    const params = [];
    let idx = 1;

    // ---------- GLOBAL SEARCH ----------
    if (q) {
      const numeric = parseInt(q, 10);
      const orClauses = [];

      if (!isNaN(numeric)) {
        orClauses.push(`regno = $${idx}`);
        params.push(numeric);
        idx++;
      }

      orClauses.push(`name ILIKE $${idx}`);
      params.push(`%${q}%`);
      idx++;

      orClauses.push(`email ILIKE $${idx}`);
      params.push(`%${q}%`);
      idx++;

      orClauses.push(`contact1 ILIKE $${idx}`);
      params.push(`%${q}%`);
      idx++;

      orClauses.push(`currentResidance ILIKE $${idx}`);
      params.push(`%${q}%`);
      idx++;

      orClauses.push(`caste ILIKE $${idx}`);
      params.push(`%${q}%`);
      idx++;

      filters.push(`(${orClauses.join(" OR ")})`);
    }

    // ---------- SIMPLE EQUAL FILTERS ----------
    if (plan) {
      filters.push(`plan = $${idx}`);
      params.push(plan);
      idx++;
    }

    if (food_habits) {
      filters.push(`food_habits = $${idx}`);
      params.push(food_habits);
      idx++;
    }

    if (gender) {
      filters.push(`gender = $${idx}`);
      params.push(gender);
      idx++;
    }

    if (education) {
      filters.push(`education = $${idx}`);
      params.push(education);
      idx++;
    }

    if (marital_status) {
      filters.push(`marital_status = $${idx}`);
      params.push(marital_status);
      idx++;
    }

    if (currentResidingLocation) {
      filters.push(`currentResidance ILIKE $${idx}`);
      params.push(`%${currentResidingLocation}%`);
      idx++;
    }

    // ---------- MULTI SELECT FILTERS ----------
    const addMultiFilter = (column, value) => {
      const values = String(value)
        .split(",")
        .map(v => v.trim())
        .filter(Boolean);

      if (values.length) {
        const placeholders = values.map(() => `$${idx++}`);
        params.push(...values);
        filters.push(`${column} IN (${placeholders.join(", ")})`);
      }
    };

    if (caste) addMultiFilter("caste", caste);
    if (yob) addMultiFilter("yob", yob);
    if (gothram) addMultiFilter("gothram", gothram);
    if (height) addMultiFilter("height", height);
    if (weight) addMultiFilter("weight", weight);
    if (star) addMultiFilter("star", star);
    if (rasi) addMultiFilter("rasi", rasi);
    if (dosham) addMultiFilter("dosham", dosham);
    if (occupation) addMultiFilter("occupation", occupation);
    if (annual_income) addMultiFilter("annual_income", annual_income);

    // ---------- DOB (STRING OR TIMESTAMP) ----------
    if (dob) {
      filters.push(`DATE(dob) = DATE($${idx})`);
      params.push(dob);
      idx++;
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const pageInt = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.min(1000, Math.max(1, parseInt(limit, 10) || 100));
    const offset = (pageInt - 1) * perPage;

    // ---------- TOTAL COUNT ----------
    const countSql = `SELECT COUNT(*)::int AS total FROM t1."T1_USERS" ${where}`;
    const countRes = await pool.query(countSql, params);
    const total = countRes.rows[0]?.total || 0;

    // ---------- MAIN QUERY ----------
    const dataSql = `
      SELECT *
      FROM t1."T1_USERS"
      ${where}
      ORDER BY created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    const finalParams = [...params, perPage, offset];
    const { rows } = await pool.query(dataSql, finalParams);

    // ---------- POST PROCESS ----------
    const users = [];
    for (const r of rows) {
      const currentStatus = await updateplan_statusInDB(r);
      const mapped = rowToUser(r);
      mapped.plan_status = currentStatus || mapped.plan_status;
      users.push(mapped);
    }

    res.json({
      users,
      total,
      page: pageInt,
      limit: perPage,
      totalPages: Math.ceil(total / perPage),
    });
  } catch (err) {
    console.error("GET /api/users error:", err);
    res.status(500).json({ message: "Server error fetching users" });
  }
});

// ============ GET FILTER OPTIONS ============

app.get("/api/users/filters", async (req, res) => {
  try {
    const queries = {
      caste: `
        SELECT DISTINCT caste 
        FROM t1."T1_USERS"
        WHERE caste IS NOT NULL AND caste <> ''
        ORDER BY caste
      `,
      gothram: `
        SELECT DISTINCT gothram
        FROM t1."T1_USERS"
        WHERE gothram IS NOT NULL AND gothram <> ''
        ORDER BY gothram
      `,
      height: `
        SELECT DISTINCT height
        FROM t1."T1_USERS"
        WHERE height IS NOT NULL AND height <> ''
        ORDER BY height
      `,
      weight: `
        SELECT DISTINCT weight
        FROM t1."T1_USERS"
        WHERE weight IS NOT NULL AND weight <> ''
        ORDER BY weight
      `,
      star: `
        SELECT DISTINCT star
        FROM t1."T1_USERS"
        WHERE star IS NOT NULL AND star <> ''
        ORDER BY star
      `,
      rasi: `
        SELECT DISTINCT rasi
        FROM t1."T1_USERS"
        WHERE rasi IS NOT NULL AND rasi <> ''
        ORDER BY rasi
      `,
      dosham: `
        SELECT DISTINCT dosham
        FROM t1."T1_USERS"
        WHERE dosham IS NOT NULL AND dosham <> ''
        ORDER BY dosham
      `,
      occupation: `
        SELECT DISTINCT occupation
        FROM t1."T1_USERS"
        WHERE occupation IS NOT NULL AND occupation <> ''
        ORDER BY occupation
      `,
      annual_income: `
        SELECT DISTINCT annual_income
        FROM t1."T1_USERS"
        WHERE annual_income IS NOT NULL AND annual_income <> ''
        ORDER BY annual_income
      `,
      education: `
        SELECT DISTINCT education
        FROM t1."T1_USERS"
        WHERE education IS NOT NULL AND education <> ''
        ORDER BY education
      `,
      gender: `
        SELECT DISTINCT gender
        FROM t1."T1_USERS"
        WHERE gender IS NOT NULL AND gender <> ''
        ORDER BY gender
      `,
      marital_status: `
        SELECT DISTINCT marital_status
        FROM t1."T1_USERS"
        WHERE marital_status IS NOT NULL AND marital_status <> ''
        ORDER BY marital_status
      `,
      yob: `
        SELECT DISTINCT yob
        FROM t1."T1_USERS"
        WHERE yob IS NOT NULL
        ORDER BY yob
      `,
      dob: `
        SELECT DISTINCT
          CASE
            WHEN dob::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
              THEN dob::date
            ELSE NULL
          END AS dob
        FROM t1."T1_USERS"
        WHERE dob IS NOT NULL
        ORDER BY dob
      `,
      current_residence: `
        SELECT DISTINCT current_residence
        FROM t1."T1_USERS"
        WHERE current_residence IS NOT NULL AND current_residence <> ''
        ORDER BY current_residence
      `
    };

    const results = {};

    for (const key of Object.keys(queries)) {
      const { rows } = await pool.query(queries[key]);
      results[key] = rows
        .map(r => Object.values(r)[0])
        .filter(v => v !== null);
    }

    res.json(results);
  } catch (err) {
    console.error("GET /api/users/filters error:", err);
    res.status(500).json({ message: "Failed to load filter options" });
  }
});


// ---------- GET /api/users/renewals-due ----------
app.get("/api/users/renewals-due", async (req, res) => {
  try {
    const days = Number(req.query.days || 10);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limitDate = new Date(today);
    limitDate.setDate(today.getDate() + days);

    // fetch users with expiry_date not null and not deleted
    const sql = `SELECT * FROM t1."T1_USERS" WHERE is_deleted = false AND expiry_date IS NOT NULL`;
    const { rows } = await pool.query(sql);

    const dueUsers = rows
      .map((u) => {
        const expiry = u.expiry_date ? new Date(u.expiry_date) : null;
        if (!expiry) return null;
        expiry.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
        return {
          ...rowToUser(u),
          expiry_date: expiry,
          daysLeft: diffDays >= 0 ? diffDays : 0,
          plan_status: diffDays >= 0 ? "active" : "expired",
        };
      })
      .filter((u) => u && u.expiry_date >= today && u.expiry_date <= limitDate);

    res.json(dueUsers);
  } catch (err) {
    console.error("Error fetching renewals:", err);
    res.status(500).json({ message: "Error fetching renewal due users" });
  }
});

// ---------- GET /api/users/check-regno/:regno ----------
app.get("/api/users/check-regno/:regno", async (req, res) => {
  try {
    const regno = parseInt(req.params.regno, 10);
    if (isNaN(regno)) return res.status(400).json({ message: "Invalid regno" });
    const sql = `SELECT 1 FROM t1."T1_USERS" WHERE regno = $1 LIMIT 1`;
    const { rowCount } = await pool.query(sql, [regno]);
    res.json({ exists: rowCount > 0 });
  } catch (err) {
    console.error("GET /api/users/check-regno error:", err);
    res.status(500).json({ message: "Error checking Reg No" });
  }
});

// ---------- GET /api/users/:id ----------
app.get("/api/users/:regno", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const sql = `SELECT * FROM t1."T1_USERS" WHERE id = $1 LIMIT 1`;
    const { rows } = await pool.query(sql, [id]);
    const doc = rows[0];
    if (!doc || doc.is_deleted) return res.status(404).json({ message: "User not found" });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isActive = doc.expiry_date && new Date(doc.expiry_date) >= today;

    const mapped = rowToUser(doc);
    mapped.plan_status = isActive ? "active" : "expired";
    res.json(mapped);
  } catch (err) {
    console.error("GET /api/users/:id error:", err);
    res.status(400).json({ message: "Bad request or invalid ID" });
  }
});

// ---------- PUT /api/users/:id (update) ----------
app.put("/api/users/:regno", async (req, res) => {
  try {
    const regno = parseInt(req.params.regno, 10);
    if (isNaN(regno)) return res.status(400).json({ message: "Invalid regno" });

    const updates = { ...req.body };

    if (updates.reg_date) updates.reg_date = parseAnyDate(updates.reg_date);
    if (updates.dob) updates.dob = parseAnyDate(updates.dob);

    // fetch current row by regno
    const curRes = await pool.query(
      `SELECT * FROM t1."T1_USERS" WHERE regno = $1 LIMIT 1`,
      [regno]
    );

    const currentDoc = curRes.rows[0];
    if (!currentDoc || currentDoc.is_deleted)
      return res.status(404).json({ message: "User not found for update" });

    // plan recalculation
    if (updates.plan || updates.reg_date) {
      const reg_date = updates.reg_date || currentDoc.reg_date;
      const plan = (updates.plan || currentDoc.plan || "entry").toLowerCase();
      const { expiry_date, amount, valid_days } = calculateexpiry_date(reg_date, plan);

      updates.expiry_date = expiry_date;
      updates.amount = amount;
      updates.valid_days = valid_days;
      updates.plan_status = getplan_status(expiry_date).toLowerCase();
    }

    // build SQL SET clause
    const setParts = [];
    const values = [];
    let idx = 1;

    const mapping = {
      regno: "regno",
      name: "name",
      gender: "gender",
      caste: "caste",
      caste_category: "caste_category",
      gothram: "gothram",
      food_habits: "food_habits",
      reg_date: "reg_date",
      plan: "plan",
      amount: "amount",
      payment_mode: "payment_mode",
      transaction_id: "transaction_id",
      valid_days: "valid_days",
      expiry_date: "expiry_date",
      plan_status: "plan_status",
      new_or_renewal: "new_or_renewal",
      marital_status: "marital_status",
      dob: "dob",
      yob: "yob",
      age: "age",
      time_of_birth: "time_of_birth",
      place_of_birth: "place_of_birth",
      height: "height",
      weight: "weight",
      star: "star",
      paadham: "paadham",
      rasi: "rasi",
      lagnam: "lagnam",
      dosham: "dosham",
      education: "education",
      ug_degree: "ug_degree",
      ug_specialization: "ug_specialization",
      pg_degree: "pg_degree",
      pg_specialization: "pg_specialization",
      occupation: "occupation",
      annual_income: "annual_income",
      father_name: "father_name",
      father_occupation: "father_occupation",
      mother_name: "mother_name",
      mother_occupation: "mother_occupation",
      sibling_details: "sibling_details",
      native_place: "native_place",
      current_residence: "current_residence",
      address: "address",
      city: "city",
      pincode: "pincode",
      state: "state",
      country: "country",
      ownHouse: "ownHouse",
      property_details: "property_details",
      expectations: "expectations",
      remarks: "remarks",
      flashed_date: "flashed_date",
      renewal_date: "renewal_date",
      renewal_amount: "renewal_amount",
      contact1: "contact1",
      contact2: "contact2",
      contact3: "contact3",
      email: "email",
      created_by: "created_by",
      modified_by: "modified_by",
      deleted_by: "deleted_by",
      is_deleted: "is_deleted"
    };

    // generate dynamic SET parts
    for (const [key, col] of Object.entries(mapping)) {
      if (updates[key] !== undefined) {
        setParts.push(`"${col}" = $${idx}`);
        values.push(updates[key]);
        idx++;
      }
    }

    if (setParts.length === 0)
      return res.status(400).json({ message: "No valid fields provided for update" });

    setParts.push(`"updated_at" = now()`);

    const sql = `
      UPDATE t1."T1_USERS"
      SET ${setParts.join(", ")}
      WHERE regno = $${idx} AND is_deleted = false
      RETURNING *
    `;
    values.push(regno);

    const { rows } = await pool.query(sql, values);
    const updated = rows[0];

    if (!updated) return res.status(404).json({ message: "User not found for update" });

    await updateplan_statusInDB(updated);

    res.json(rowToUser(updated));
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ message: "Duplicate regno" });
    }
    console.error("PUT /api/users/:regno error:", err);
    res.status(400).json({ message: "Bad request during update" });
  }
});

app.patch("/api/users/:regno/delete", async (req, res) => {
  try {
    const regno = parseInt(req.params.regno, 10);
    if (isNaN(regno)) return res.status(400).json({ message: "Invalid regno" });

    const sql = `
      UPDATE t1."T1_USERS"
      SET is_deleted = true, "updated_at" = now(), deleted_by = $1
      WHERE regno = $2
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [req.body.deleted_by, regno]);
    const doc = rows[0];

    if (!doc) return res.status(404).json({ message: "User not found" });

    res.json({ message: "User successfully marked as deleted" });
  } catch (err) {
    console.error("PATCH /api/users/:regno/delete error:", err);
    res.status(400).json({ message: "Bad request during delete" });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

export default app
// If you want to run directly with `node app.js` uncomment below:
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}