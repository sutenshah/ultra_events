# 🔌 SQL Server Connection Guide

## Mapping Your Connection Details to .env File

If you have SQL Server connection details in this format:
- **Provider**
- **Persist Security Info**
- **User ID** (or UserId)
- **Password**
- **Initial Catalog** (Database Name)
- **Data Source** (Server Address)
- **Port**

Here's how to map them to your `.env` file:

---

## 📝 Method 1: Individual Parameters (Recommended)

Add these to your `.env` file:

```env
# ==========================================
# SQL SERVER CONFIGURATION
# ==========================================
# Data Source = Server Address
SQL_SERVER=your-server-name.database.windows.net
# OR use SQL_DATA_SOURCE if you prefer
# SQL_DATA_SOURCE=your-server-name.database.windows.net

# Initial Catalog = Database Name
SQL_DATABASE=UltraaEvents
# OR use SQL_INITIAL_CATALOG if you prefer
# SQL_INITIAL_CATALOG=UltraaEvents

# User ID = Username
SQL_USER=your_username
# OR use SQL_USER_ID if you prefer
# SQL_USER_ID=your_username

# Password
SQL_PASSWORD=your_password

# Port (usually 1433 for SQL Server)
SQL_PORT=1433

# Encryption (usually true for remote servers)
SQL_ENCRYPT=true

# Trust Server Certificate (set to false for production with proper certificates)
SQL_TRUST_SERVER_CERTIFICATE=true
```

### Example with Real Values:

```env
SQL_SERVER=mydbserver.database.windows.net
SQL_DATABASE=UltraaEvents
SQL_USER=admin_user
SQL_PASSWORD=MySecurePassword123!
SQL_PORT=1433
SQL_ENCRYPT=true
SQL_TRUST_SERVER_CERTIFICATE=true
```

---

## 📝 Method 2: Connection String (Alternative)

If you prefer to use a connection string directly:

```env
# Full connection string format
SQL_CONNECTION_STRING=Server=your-server.database.windows.net,1433;Database=UltraaEvents;User Id=your_username;Password=your_password;Encrypt=True;TrustServerCertificate=True
```

### Connection String Format:

```
Server=<Data Source>,<Port>;Database=<Initial Catalog>;User Id=<User ID>;Password=<Password>;Encrypt=True;TrustServerCertificate=True
```

---

## 🔍 Field Mapping Reference

| Your Field Name | .env Variable | Description |
|----------------|---------------|-------------|
| **Data Source** | `SQL_SERVER` or `SQL_DATA_SOURCE` | Server address/hostname |
| **Initial Catalog** | `SQL_DATABASE` or `SQL_INITIAL_CATALOG` | Database name |
| **User ID** | `SQL_USER` or `SQL_USER_ID` | Username for authentication |
| **Password** | `SQL_PASSWORD` | Password for authentication |
| **Port** | `SQL_PORT` | Port number (default: 1433) |
| **Provider** | *(Not needed)* | Automatically handled by mssql package |
| **Persist Security Info** | *(Not needed)* | Not used in Node.js connection |

---

## 🌐 Common SQL Server Types

### Azure SQL Database
```env
SQL_SERVER=your-server.database.windows.net
SQL_DATABASE=UltraaEvents
SQL_USER=admin@your-server
SQL_PASSWORD=your_password
SQL_PORT=1433
SQL_ENCRYPT=true
SQL_TRUST_SERVER_CERTIFICATE=false
```

### AWS RDS SQL Server
```env
SQL_SERVER=your-rds-endpoint.region.rds.amazonaws.com
SQL_DATABASE=UltraaEvents
SQL_USER=admin
SQL_PASSWORD=your_password
SQL_PORT=1433
SQL_ENCRYPT=true
SQL_TRUST_SERVER_CERTIFICATE=true
```

### Remote SQL Server (On-Premise)
```env
SQL_SERVER=192.168.1.100
# OR
SQL_SERVER=sql-server-hostname
SQL_DATABASE=UltraaEvents
SQL_USER=sa
SQL_PASSWORD=your_password
SQL_PORT=1433
SQL_ENCRYPT=false
SQL_TRUST_SERVER_CERTIFICATE=true
```

### Local SQL Server
```env
SQL_SERVER=localhost
# OR
SQL_SERVER=127.0.0.1
SQL_DATABASE=UltraaEvents
SQL_USER=sa
SQL_PASSWORD=your_password
SQL_PORT=1433
SQL_ENCRYPT=false
SQL_TRUST_SERVER_CERTIFICATE=true
```

---

## ✅ Testing Your Connection

After adding your credentials to `.env`, test the connection:

```bash
# Start the server
node server.js
```

**Expected Output:**
```
✅ SQL Server connected
✅ Database tables created/verified successfully!
🚀 ULTRAA EVENTS API SERVER
========================================
✅ Server running on port 3000
```

If you see connection errors, check:

1. **Firewall Rules**: Ensure your IP is allowed to connect
2. **SQL Server Authentication**: Make sure SQL Authentication is enabled (not just Windows Auth)
3. **Network Access**: Verify you can reach the server from your network
4. **Credentials**: Double-check username and password
5. **Port**: Ensure port 1433 (or your custom port) is open

---

## 🔧 Troubleshooting

### Error: "Login failed for user"
- Check username and password are correct
- Verify SQL Server Authentication is enabled
- Ensure user has access to the database

### Error: "Cannot connect to server"
- Check firewall allows your IP
- Verify server address is correct
- Ensure SQL Server is running and accessible
- Check port number is correct

### Error: "Encryption not supported"
- Set `SQL_ENCRYPT=false` for local servers
- For Azure SQL, keep `SQL_ENCRYPT=true`
- Set `SQL_TRUST_SERVER_CERTIFICATE=true` for development

### Error: "Timeout expired"
- Check network connectivity
- Verify server is not overloaded
- Increase timeout in connection pool settings

---

## 🔐 Security Best Practices

1. **Never commit `.env` to Git**
   ```bash
   echo ".env" >> .gitignore
   ```

2. **Use Strong Passwords**: Use complex passwords for SQL Server accounts

3. **Limit IP Access**: Configure firewall to allow only trusted IPs

4. **Use Encrypted Connections**: Always use `SQL_ENCRYPT=true` for remote servers

5. **Rotate Credentials**: Regularly update passwords

6. **Use Least Privilege**: Grant only necessary permissions to the database user

---

## 📞 Need Help?

If you're still having connection issues:

1. Test connection using SQL Server Management Studio (SSMS)
2. Verify credentials work there first
3. Check SQL Server error logs
4. Ensure SQL Server Browser service is running (for named instances)

---

**Your `.env` file should now be configured correctly!** 🎉

