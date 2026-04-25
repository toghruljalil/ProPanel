# ProPanel

Role-based project management dashboard built with HTML, CSS, JavaScript, Node.js, Express, JWT authentication, and PostgreSQL.

## Features

- Login with JWT authentication
- Admin, editor, and viewer roles
- Role-based permissions for projects, users, and reports
- Project create, edit, delete, search, and progress tracking
- User management for admin users
- Recent activity feed
- PostgreSQL database initialization with demo data

## Tech Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express
- Database: PostgreSQL
- Auth: JWT, bcryptjs

## Requirements

- Node.js
- PostgreSQL
- npm

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a PostgreSQL database:

```sql
CREATE DATABASE propanel;
```

3. Create a `.env` file in the project root:

```env
PORT=3000
DB_USER=postgres
DB_HOST=localhost
DB_NAME=propanel
DB_PASSWORD=postgres
DB_PORT=5432
JWT_SECRET=change-this-secret
```

4. Start the server:

```bash
npm start
```

For development with auto-restart:

```bash
npm run dev
```

5. Open the app:

```text
http://localhost:3000
```

## Demo Accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@propanel.com | admin123 |
| Editor | editor@propanel.com | editor123 |
| Viewer | viewer@propanel.com | viewer123 |

## Project Structure

```text
.
├── index.html
├── style.css
├── responsive.css
├── app.js
├── package.json
└── server
    ├── server.js
    ├── db.js
    └── init.sql
```

## Short Description

ProPanel is a simple project management panel that demonstrates secure login, role-based access control, project tracking, and user administration.
