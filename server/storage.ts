import { users, type User, type InsertUser, competitions, type Competition, type InsertCompetition, entries, type Entry, type InsertEntry, winners, type Winner, type InsertWinner, siteConfig, type SiteConfig, type InsertSiteConfig } from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, lte, gte, and, or, sql } from "drizzle-orm";
import session from "express-session";
import createMemoryStore from "memorystore";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

const MemoryStore = createMemoryStore(session);
const PostgresSessionStore = connectPg(session);

// modify the interface with any CRUD methods
// you might need
export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: Omit<InsertUser, "confirmPassword" | "agreeToTerms">): Promise<User>;
  updateUser(id: number, user: Partial<User>): Promise<User | undefined>;
  deleteUser(id: number): Promise<boolean>;
  promoteToAdmin(id: number): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>; // Added for admin dashboard
  
  // Competition operations
  getCompetition(id: number): Promise<Competition | undefined>;
  listCompetitions(options?: { 
    category?: string, 
    limit?: number, 
    offset?: number,
    isLive?: boolean,
    isFeatured?: boolean,
    sortBy?: 'newest' | 'endingSoon' | 'popular'
  }): Promise<Competition[]>;
  createCompetition(competition: InsertCompetition): Promise<Competition>;
  updateCompetition(id: number, competition: Partial<Competition>): Promise<Competition | undefined>;
  deleteCompetition(id: number): Promise<boolean>;
  
  // Entry operations
  createEntry(entry: InsertEntry): Promise<Entry>;
  getEntries(userId: number): Promise<Entry[]>;
  getEntriesByCompetition(competitionId: number): Promise<Entry[]>;
  updateEntryPaymentStatus(id: number, status: string, paymentId?: string): Promise<Entry | undefined>;
  getAllEntries(): Promise<Entry[]>; // Added for admin dashboard
  
  // Winner operations
  createWinner(winner: InsertWinner): Promise<Winner>;
  getWinners(userId: number): Promise<Winner[]>;
  getWinnersByCompetition(competitionId: number): Promise<Winner[]>;
  updateWinnerClaimStatus(id: number, status: string): Promise<Winner | undefined>;

  // Site configuration operations
  getSiteConfig(key: string): Promise<SiteConfig | undefined>;
  setSiteConfig(config: InsertSiteConfig): Promise<SiteConfig>;
  getAllSiteConfig(): Promise<SiteConfig[]>;

  // Session store
  sessionStore: session.SessionStore;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private competitions: Map<number, Competition>;
  private entries: Map<number, Entry>;
  private winners: Map<number, Winner>;
  private siteConfig: Map<string, SiteConfig>;
  
  userCurrentId: number;
  competitionCurrentId: number;
  entryCurrentId: number;
  winnerCurrentId: number;
  siteConfigCurrentId: number;
  
  sessionStore: session.SessionStore;

  constructor() {
    this.users = new Map();
    this.competitions = new Map();
    this.entries = new Map();
    this.winners = new Map();
    this.siteConfig = new Map();
    
    this.userCurrentId = 1;
    this.competitionCurrentId = 1;
    this.entryCurrentId = 1;
    this.winnerCurrentId = 1;
    this.siteConfigCurrentId = 1;
    
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000 // prune expired entries every 24h
    });
    
    // Create admin test account using env variables with fallbacks
    const adminUsername = process.env.ADMIN_USERNAME || "admin";
    const adminEmail = process.env.ADMIN_EMAIL || "admin@bluewhalecompetitions.co.uk";
    // Use the hashed password from env or fallback to the default Admin123! password
    const adminPassword = process.env.ADMIN_PASSWORD_HASH || 
      "dc7e15589e3e3e7d4dcc85d1537a6e434e4ed9d2aa9714aaaaf2ec3e7911b713f65b4e01f359c0c1c90b0f4eab43c7a2c7783cbf60ccc926f37a834cd55d1e8b.84d311fb547ffd10efaf0fcbea1c52c5";
    
    const adminUser: User = {
      id: this.userCurrentId++,
      username: adminUsername,
      email: adminEmail,
      password: adminPassword,
      displayName: adminUsername,
      mascot: "blue-whale",
      isAdmin: true,
      isBanned: false,
      stripeCustomerId: null,
      notificationSettings: { email: true, inApp: true },
      createdAt: new Date()
    };
    this.users.set(adminUser.id, adminUser);
    
    // Add sample competitions
    this.seedCompetitions();
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username.toLowerCase() === username.toLowerCase(),
    );
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email.toLowerCase() === email.toLowerCase(),
    );
  }

  async createUser(userData: Omit<InsertUser, "confirmPassword" | "agreeToTerms">): Promise<User> {
    const id = this.userCurrentId++;
    const now = new Date();
    const user: User = { 
      ...userData, 
      id,
      mascot: userData.mascot ?? 'blue-whale',
      isAdmin: false,
      notificationSettings: userData.notificationSettings ?? { email: true, inApp: true },
      createdAt: now
    };
    this.users.set(id, user);
    return user;
  }
  
  async updateUser(id: number, userData: Partial<User>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, ...userData };
    this.users.set(id, updatedUser);
    return updatedUser;
  }
  
  async deleteUser(id: number): Promise<boolean> {
    const user = this.users.get(id);
    if (!user) return false;
    
    // Delete user's entries
    const userEntries = await this.getEntries(id);
    for (const entry of userEntries) {
      this.entries.delete(entry.id);
    }
    
    // Delete user's winners
    const userWinners = await this.getWinners(id);
    for (const winner of userWinners) {
      this.winners.delete(winner.id);
    }
    
    // Delete the user
    return this.users.delete(id);
  }
  
  // Method to promote a user to admin
  async promoteToAdmin(id: number): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, isAdmin: true };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  // Competition operations
  async getCompetition(id: number): Promise<Competition | undefined> {
    return this.competitions.get(id);
  }
  
  async listCompetitions(options: { 
    category?: string, 
    limit?: number, 
    offset?: number,
    isLive?: boolean,
    isFeatured?: boolean,
    sortBy?: 'newest' | 'endingSoon' | 'popular'
  } = {}): Promise<Competition[]> {
    let competitions = Array.from(this.competitions.values());
    
    // Filter by category if provided
    if (options.category) {
      competitions = competitions.filter(comp => comp.category === options.category);
    }
    
    // Filter by live status if provided
    if (options.isLive !== undefined) {
      competitions = competitions.filter(comp => comp.isLive === options.isLive);
    }
    
    // Filter by featured status if provided
    if (options.isFeatured !== undefined) {
      competitions = competitions.filter(comp => comp.isFeatured === options.isFeatured);
    }
    
    // Sort by option
    if (options.sortBy) {
      switch (options.sortBy) {
        case 'newest':
          competitions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          break;
        case 'endingSoon':
          competitions.sort((a, b) => a.drawDate.getTime() - b.drawDate.getTime());
          break;
        case 'popular':
          competitions.sort((a, b) => b.ticketsSold - a.ticketsSold);
          break;
      }
    }
    
    // Apply pagination
    if (options.offset !== undefined || options.limit !== undefined) {
      const offset = options.offset || 0;
      const limit = options.limit || competitions.length;
      competitions = competitions.slice(offset, offset + limit);
    }
    
    return competitions;
  }
  
  async createCompetition(competitionData: InsertCompetition): Promise<Competition> {
    const id = this.competitionCurrentId++;
    const now = new Date();
    const competition: Competition = {
      ...competitionData,
      id,
      ticketsSold: 0,
      createdAt: now
    };
    this.competitions.set(id, competition);
    return competition;
  }
  
  async updateCompetition(id: number, competitionData: Partial<Competition>): Promise<Competition | undefined> {
    const competition = this.competitions.get(id);
    if (!competition) return undefined;
    
    const updatedCompetition = { ...competition, ...competitionData };
    this.competitions.set(id, updatedCompetition);
    return updatedCompetition;
  }
  
  async deleteCompetition(id: number): Promise<boolean> {
    const competition = this.competitions.get(id);
    if (!competition) return false;
    
    // Check if there are any entries for this competition
    const entriesForCompetition = await this.getEntriesByCompetition(id);
    if (entriesForCompetition.length > 0) {
      // If there are entries, don't delete it
      return false;
    }
    
    // Delete the competition
    return this.competitions.delete(id);
  }
  
  // Entry operations
  async createEntry(entryData: InsertEntry): Promise<Entry> {
    const id = this.entryCurrentId++;
    const now = new Date();
    const entry: Entry = {
      ...entryData,
      id,
      createdAt: now
    };
    this.entries.set(id, entry);
    
    // Update competition ticket count
    const competition = await this.getCompetition(entryData.competitionId);
    if (competition) {
      await this.updateCompetition(competition.id, {
        ticketsSold: competition.ticketsSold + entryData.ticketCount
      });
    }
    
    return entry;
  }
  
  async getEntries(userId: number): Promise<Entry[]> {
    return Array.from(this.entries.values()).filter(entry => entry.userId === userId);
  }
  
  async getEntriesByCompetition(competitionId: number): Promise<Entry[]> {
    return Array.from(this.entries.values()).filter(entry => entry.competitionId === competitionId);
  }
  
  async updateEntryPaymentStatus(id: number, status: string, paymentId?: string): Promise<Entry | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    
    const updatedEntry: Entry = {
      ...entry,
      paymentStatus: status,
      ...(paymentId ? { stripePaymentId: paymentId } : {})
    };
    this.entries.set(id, updatedEntry);
    return updatedEntry;
  }
  
  // Winner operations
  async createWinner(winnerData: InsertWinner): Promise<Winner> {
    const id = this.winnerCurrentId++;
    const now = new Date();
    const winner: Winner = {
      ...winnerData,
      id,
      announcedAt: now,
      claimStatus: 'pending'
    };
    this.winners.set(id, winner);
    return winner;
  }
  
  async getWinners(userId: number): Promise<Winner[]> {
    return Array.from(this.winners.values()).filter(winner => winner.userId === userId);
  }
  
  async getWinnersByCompetition(competitionId: number): Promise<Winner[]> {
    return Array.from(this.winners.values()).filter(winner => winner.competitionId === competitionId);
  }
  
  async updateWinnerClaimStatus(id: number, status: string): Promise<Winner | undefined> {
    const winner = this.winners.get(id);
    if (!winner) return undefined;
    
    const updatedWinner: Winner = {
      ...winner,
      claimStatus: status
    };
    this.winners.set(id, updatedWinner);
    return updatedWinner;
  }
  
  // Get all users - added for admin dashboard
  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }
  
  // Get all entries - added for admin dashboard
  async getAllEntries(): Promise<Entry[]> {
    return Array.from(this.entries.values());
  }
  
  // Site configuration operations
  async getSiteConfig(key: string): Promise<SiteConfig | undefined> {
    // Find by key in the map (values)
    return Array.from(this.siteConfig.values()).find(
      (config) => config.key === key
    );
  }
  
  async setSiteConfig(config: InsertSiteConfig): Promise<SiteConfig> {
    // Check if config with this key already exists
    const existingConfig = await this.getSiteConfig(config.key);
    
    if (existingConfig) {
      // Update the existing config
      const updatedConfig: SiteConfig = {
        ...existingConfig,
        value: config.value,
        description: config.description,
        updatedAt: new Date()
      };
      this.siteConfig.set(existingConfig.id, updatedConfig);
      return updatedConfig;
    } else {
      // Create a new config
      const id = this.siteConfigCurrentId++;
      const now = new Date();
      const newConfig: SiteConfig = {
        ...config,
        id,
        updatedAt: now
      };
      this.siteConfig.set(id, newConfig);
      return newConfig;
    }
  }
  
  async getAllSiteConfig(): Promise<SiteConfig[]> {
    return Array.from(this.siteConfig.values());
  }

  // Seed method for demo competitions
  private seedCompetitions() {
    const oneDay = 24 * 60 * 60 * 1000;
    const now = new Date();
    
    const demoCompetitions: Omit<Competition, 'id' | 'createdAt'>[] = [
      {
        title: "Ninja Air Fryer",
        description: "Enter for your chance to win an air fryer.",
        imageUrl: "https://images.unsplash.com/photo-1613825787641-2e6f3d85a6d7?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&h=300&q=80",
        category: "appliances",
        prizeValue: 25000, // £250.00
        ticketPrice: 100, // £1.00
        maxTicketsPerUser: 10,
        totalTickets: 1000,
        ticketsSold: 50,
        brand: "Ninja",
        drawDate: new Date(now.getTime() + 5 * oneDay), // 5 days from now
        isLive: true,
        isFeatured: true
      },
      {
        title: "Family Adventure Package",
        description: "Win a family adventure package for four with all expenses paid.",
        imageUrl: "https://images.unsplash.com/photo-1553174241-8e01301bd424?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&h=300&q=80",
        category: "family",
        prizeValue: 100000, // £1,000.00
        ticketPrice: 250, // £2.50
        maxTicketsPerUser: 5,
        totalTickets: 800,
        ticketsSold: 380,
        brand: "Adventure Co",
        drawDate: new Date(now.getTime() + 3 * oneDay), // 3 days from now
        isLive: true,
        isFeatured: false
      },
      {
        title: "£5,000 Cash Prize",
        description: "Win £5,000 cash delivered directly to your account.",
        imageUrl: "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&h=300&q=80",
        category: "cash",
        prizeValue: 500000, // £5,000.00
        ticketPrice: 500, // £5.00
        maxTicketsPerUser: 20,
        totalTickets: 1000,
        ticketsSold: 875,
        brand: "Cash Rewards",
        drawDate: new Date(now.getTime() + oneDay / 3), // 8 hours from now
        isLive: true,
        isFeatured: true
      },
      {
        title: "Dyson Vacuum Cleaner",
        description: "Win a brand new Dyson V11 vacuum cleaner.",
        imageUrl: "https://images.unsplash.com/photo-1600495772677-8b1ff7256ebe?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&h=300&q=80",
        category: "appliances",
        prizeValue: 50000, // £500.00
        ticketPrice: 350, // £3.50
        maxTicketsPerUser: 8,
        totalTickets: 1000,
        ticketsSold: 365,
        brand: "Dyson",
        drawDate: new Date(now.getTime() + 2 * oneDay), // 2 days from now
        isLive: true,
        isFeatured: false
      }
    ];
    
    // Add demo competitions to the map
    demoCompetitions.forEach(comp => {
      this.createCompetition({
        ...comp,
        ticketsSold: 0 // ticketsSold will be set by createCompetition
      });
    });
  }
}

// Implementation of storage interface using a PostgreSQL database
export class DatabaseStorage implements IStorage {
  sessionStore: session.SessionStore;

  constructor() {
    this.sessionStore = new PostgresSessionStore({
      pool,
      tableName: 'session',
      createTableIfMissing: true
    });
    
    // Initialize database schema and seed data
    this.ensureTablesExist()
      .then(() => this.seedAdminUser())
      .then(() => console.log("🚀 Database initialization complete"))
      .catch(error => console.error("❌ Error during database initialization:", error));
  }
  
  // Get all users - added for admin dashboard
  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }
  
  // Get all entries - added for admin dashboard
  async getAllEntries(): Promise<Entry[]> {
    return db.select().from(entries);
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return user;
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return user;
  }

  async createUser(userData: Omit<InsertUser, "confirmPassword" | "agreeToTerms">): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        ...userData,
        mascot: userData.mascot ?? 'blue-whale',
        isAdmin: false,
        notificationSettings: userData.notificationSettings ?? { email: true, inApp: true }
      })
      .returning();
    return user;
  }
  
  async updateUser(id: number, userData: Partial<User>): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set(userData)
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  }
  
  async promoteToAdmin(id: number): Promise<User | undefined> {
    return this.updateUser(id, { isAdmin: true });
  }
  
  async deleteUser(id: number): Promise<boolean> {
    try {
      // First, find all entries for the user and delete them
      const userEntries = await this.getEntries(id);
      for (const entry of userEntries) {
        await db
          .delete(entries)
          .where(eq(entries.id, entry.id));
      }
      
      // Then, find all winners for the user and delete them
      const userWinners = await this.getWinners(id);
      for (const winner of userWinners) {
        await db
          .delete(winners)
          .where(eq(winners.id, winner.id));
      }
      
      // Finally, delete the user
      const result = await db
        .delete(users)
        .where(eq(users.id, id));
      
      // Return true if the user was deleted
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting user:', error);
      return false;
    }
  }

  // Competition operations
  async getCompetition(id: number): Promise<Competition | undefined> {
    try {
      // First try standard Drizzle ORM approach
      const [competition] = await db
        .select()
        .from(competitions)
        .where(eq(competitions.id, id))
        .limit(1);
      
      if (competition) {
        return competition;
      }
      
      // If the standard approach fails, try a more resilient method using raw SQL
      // This handles schema differences between environments
      console.log(`🔄 Using fallback SQL query for competition ID: ${id}`);
      
      try {
        const { pool } = await import('./db');
        
        // Get column information from the database to make a dynamic query
        const columnInfoResult = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'competitions'
        `);
        
        const availableColumns = columnInfoResult.rows.map(row => row.column_name);
        console.log(`📊 Available columns in competitions table:`, availableColumns);
        
        // Build a dynamic SELECT statement based on available columns
        const columnList = availableColumns.join(', ');
        
        // Execute the dynamic query
        const result = await pool.query(`
          SELECT ${columnList}
          FROM competitions
          WHERE id = $1
          LIMIT 1
        `, [id]);
        
        if (result.rows.length > 0) {
          console.log(`✅ Successfully retrieved competition with ID ${id} using fallback SQL`);
          return result.rows[0];
        }
        
        console.log(`❓ No competition found with ID ${id} using fallback method`);
        return undefined;
      } catch (sqlError) {
        console.error(`❌ SQL fallback method failed:`, sqlError);
        throw sqlError; // Re-throw to be caught by the outer try-catch
      }
    } catch (error) {
      console.error(`❌ Error retrieving competition with ID ${id}:`, error);
      throw error; // Re-throw to be handled by the route handler
    }
  }
  
  async listCompetitions(options: { 
    category?: string, 
    limit?: number, 
    offset?: number,
    isLive?: boolean,
    isFeatured?: boolean,
    sortBy?: 'newest' | 'endingSoon' | 'popular'
  } = {}): Promise<Competition[]> {
    let query = db.select().from(competitions);
    
    // Build the where conditions
    const conditions = [];
    
    if (options.category) {
      // Make category filtering case-insensitive by converting both sides to lowercase
      conditions.push(sql`LOWER(${competitions.category}) = LOWER(${options.category})`);
    }
    
    if (options.isLive !== undefined) {
      conditions.push(eq(competitions.isLive, options.isLive));
    }
    
    if (options.isFeatured !== undefined) {
      conditions.push(eq(competitions.isFeatured, options.isFeatured));
    }
    
    // Apply all conditions if any
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    // Apply sorting
    if (options.sortBy) {
      switch (options.sortBy) {
        case 'newest':
          query = query.orderBy(desc(competitions.createdAt));
          break;
        case 'endingSoon':
          query = query.orderBy(asc(competitions.drawDate));
          break;
        case 'popular':
          query = query.orderBy(desc(competitions.ticketsSold));
          break;
      }
    }
    
    // Apply pagination
    if (options.offset !== undefined) {
      query = query.offset(options.offset);
    }
    
    if (options.limit !== undefined) {
      query = query.limit(options.limit);
    }
    
    return query;
  }
  
  async createCompetition(competitionData: InsertCompetition): Promise<Competition> {
    // Ensure drawDate is a proper Date object
    let processedData = { ...competitionData };
    
    // Validate and process drawDate
    if (processedData.drawDate) {
      try {
        // If it's a string or timestamp, convert to Date
        if (typeof processedData.drawDate === 'string' || typeof processedData.drawDate === 'number') {
          processedData.drawDate = new Date(processedData.drawDate);
          console.log('📅 Converted drawDate from string/number to Date object');
        }
        
        // Verify the Date is valid
        if (!(processedData.drawDate instanceof Date) || isNaN(processedData.drawDate.getTime())) {
          console.warn('⚠️ Invalid drawDate provided, using current date as fallback');
          processedData.drawDate = new Date(); // Fallback to current date
        } else {
          // Valid date, show ISO string format for debugging
          console.log(`📅 Valid drawDate: ${processedData.drawDate.toISOString()}`);
        }
      } catch (error) {
        console.error('❌ Error processing drawDate:', error);
        processedData.drawDate = new Date(); // Fallback to current date
      }
    } else {
      // No drawDate provided, use current date
      console.warn('⚠️ No drawDate provided, using current date');
      processedData.drawDate = new Date();
    }
    
    const [competition] = await db
      .insert(competitions)
      .values({
        ...processedData,
        ticketsSold: 0
      })
      .returning();
    return competition;
  }
  
  async updateCompetition(id: number, competitionData: Partial<Competition>): Promise<Competition | undefined> {
    // Handle drawDate specially to ensure it's a valid Date object before updating
    let dataToUpdate = { ...competitionData };
    
    if (dataToUpdate.drawDate) {
      try {
        // Ensure drawDate is a proper Date object
        const drawDateVal = dataToUpdate.drawDate;
        
        if (typeof drawDateVal === 'string') {
          // If it's a string, convert to Date
          dataToUpdate.drawDate = new Date(drawDateVal);
          console.log('📅 UPDATE: Converted drawDate from string to Date object');
        } else if (typeof drawDateVal === 'number') {
          // If it's a timestamp, convert to Date
          dataToUpdate.drawDate = new Date(drawDateVal);
          console.log('📅 UPDATE: Converted drawDate from timestamp to Date object');
        } else if (!(drawDateVal instanceof Date)) {
          // If it's neither a string, number nor a Date, use current date as fallback
          console.warn('⚠️ UPDATE: Invalid drawDate format, using current date instead');
          dataToUpdate.drawDate = new Date();
        }
        
        // Validate that we have a proper Date object now
        if (!(dataToUpdate.drawDate instanceof Date) || isNaN(dataToUpdate.drawDate.getTime())) {
          console.warn('⚠️ UPDATE: Invalid date after conversion, using current date instead');
          dataToUpdate.drawDate = new Date();
        } else {
          // Valid date, show ISO string format for debugging
          console.log(`📅 UPDATE: Valid drawDate: ${dataToUpdate.drawDate.toISOString()}`);
        }
      } catch (error) {
        console.error('❌ UPDATE: Error processing drawDate:', error);
        // Remove problematic drawDate from update if it can't be processed
        delete dataToUpdate.drawDate;
      }
    }
    
    const [updatedCompetition] = await db
      .update(competitions)
      .set(dataToUpdate)
      .where(eq(competitions.id, id))
      .returning();
    return updatedCompetition;
  }
  
  async deleteCompetition(id: number): Promise<boolean> {
    try {
      console.log(`🔍 DB deletion: Attempting to delete competition with ID: ${id}`);
      
      // First check if the competition exists 
      const competition = await this.getCompetition(id);
      if (!competition) {
        console.log(`⚠️ DB deletion: Competition ID ${id} not found`);
        return false;
      }
      
      // Enhanced error handling for Render environment 
      try {
        // Delete the competition directly - no check for entries table
        const result = await db.delete(competitions).where(eq(competitions.id, id));
        console.log(`✅ DB deletion: Successfully deleted competition ID: ${id}`, result);
        return true;
      } catch (error) {
        // Log the error for debugging
        console.error(`❌ DB deletion error for competition ID ${id}:`, error);
        
        // Try a different approach if the first one failed
        // This is a fallback for production environment issues
        try {
          console.log(`🔄 DB deletion: Attempting alternative deletion method for ID: ${id}`);
          
          // Use a raw SQL query as a last resort if ORM fails
          const sql = `DELETE FROM "competitions" WHERE "id" = $1`;
          await db.execute(sql, [id]);
          
          console.log(`✅ DB deletion: Successfully deleted competition ID ${id} using raw SQL`);
          return true;
        } catch (fallbackError) {
          console.error(`❌ DB deletion fallback error for ID ${id}:`, fallbackError);
          throw fallbackError;
        }
      }
    } catch (error) {
      console.error(`❌ DB deleteCompetition error:`, error);
      throw error;
    }
  }
  
  // Entry operations
  async createEntry(entryData: InsertEntry): Promise<Entry> {
    // Start a transaction
    const [entry] = await db.transaction(async (tx) => {
      // Insert the entry
      const [entry] = await tx
        .insert(entries)
        .values(entryData)
        .returning();
        
      // Update the competition's tickets sold count
      await tx
        .update(competitions)
        .set({
          ticketsSold: sql`${competitions.ticketsSold} + ${entryData.ticketCount}`
        })
        .where(eq(competitions.id, entryData.competitionId));
        
      return [entry];
    });
    
    return entry;
  }
  
  async getEntries(userId: number): Promise<Entry[]> {
    return db
      .select()
      .from(entries)
      .where(eq(entries.userId, userId));
  }
  
  async getEntriesByCompetition(competitionId: number): Promise<Entry[]> {
    return db
      .select()
      .from(entries)
      .where(eq(entries.competitionId, competitionId));
  }
  
  async updateEntryPaymentStatus(id: number, status: string, paymentId?: string): Promise<Entry | undefined> {
    const updateData: Partial<Entry> = { paymentStatus: status };
    if (paymentId) {
      updateData.stripePaymentId = paymentId;
    }
    
    const [updatedEntry] = await db
      .update(entries)
      .set(updateData)
      .where(eq(entries.id, id))
      .returning();
    return updatedEntry;
  }
  
  // Winner operations
  async createWinner(winnerData: InsertWinner): Promise<Winner> {
    const [winner] = await db
      .insert(winners)
      .values({
        ...winnerData,
        claimStatus: 'pending'
      })
      .returning();
    return winner;
  }
  
  async getWinners(userId: number): Promise<Winner[]> {
    return db
      .select()
      .from(winners)
      .where(eq(winners.userId, userId));
  }
  
  async getWinnersByCompetition(competitionId: number): Promise<Winner[]> {
    return db
      .select()
      .from(winners)
      .where(eq(winners.competitionId, competitionId));
  }
  
  async updateWinnerClaimStatus(id: number, status: string): Promise<Winner | undefined> {
    const [updatedWinner] = await db
      .update(winners)
      .set({ claimStatus: status })
      .where(eq(winners.id, id))
      .returning();
    return updatedWinner;
  }

  // Site configuration operations
  async getSiteConfig(key: string): Promise<SiteConfig | undefined> {
    const [config] = await db
      .select()
      .from(siteConfig)
      .where(eq(siteConfig.key, key))
      .limit(1);
    return config;
  }
  
  async setSiteConfig(config: InsertSiteConfig): Promise<SiteConfig> {
    // Check if config with this key already exists
    const existingConfig = await this.getSiteConfig(config.key);
    
    if (existingConfig) {
      // Update the existing config
      const [updatedConfig] = await db
        .update(siteConfig)
        .set({
          value: config.value,
          description: config.description,
          updatedAt: new Date()
        })
        .where(eq(siteConfig.id, existingConfig.id))
        .returning();
      return updatedConfig;
    } else {
      // Create a new config
      const [newConfig] = await db
        .insert(siteConfig)
        .values(config)
        .returning();
      return newConfig;
    }
  }
  
  async getAllSiteConfig(): Promise<SiteConfig[]> {
    return db.select().from(siteConfig);
  }

  // Method to seed the admin user if it doesn't exist
  async seedAdminUser() {
    // Get admin credentials from environment variables with fallbacks
    const adminUsername = process.env.ADMIN_USERNAME || "admin";
    const adminEmail = process.env.ADMIN_EMAIL || "admin@bluewhalecompetitions.co.uk";
    
    // Support both plain text and hashed passwords
    let adminPassword;
    
    // First check if we have a pre-hashed password
    if (process.env.ADMIN_PASSWORD_HASH) {
      console.log("Using pre-hashed admin password from ADMIN_PASSWORD_HASH");
      adminPassword = process.env.ADMIN_PASSWORD_HASH;
    } 
    // Then check if we have a plain text password that needs hashing
    else if (process.env.ADMIN_PASSWORD) {
      console.log("Hashing plain text admin password from ADMIN_PASSWORD");
      // Import the hashPassword function from auth.ts
      const { scrypt, randomBytes } = await import('crypto');
      const { promisify } = await import('util');
      const scryptAsync = promisify(scrypt);
      
      // Hash the password using the same algorithm as in auth.ts
      const salt = randomBytes(16).toString("hex");
      const buf = (await scryptAsync(process.env.ADMIN_PASSWORD, salt, 64)) as Buffer;
      adminPassword = `${buf.toString("hex")}.${salt}`;
      console.log("Successfully hashed admin password");
    }
    // If neither is provided, use the default hashed password for Admin123!
    else {
      console.log("Using default hashed password for admin");
      adminPassword = "dc7e15589e3e3e7d4dcc85d1537a6e434e4ed9d2aa9714aaaaf2ec3e7911b713f65b4e01f359c0c1c90b0f4eab43c7a2c7783cbf60ccc926f37a834cd55d1e8b.84d311fb547ffd10efaf0fcbea1c52c5";
    }
    
    // Check if admin user exists
    const adminUser = await this.getUserByUsername(adminUsername);
    if (!adminUser) {
      // Create admin user with credentials from environment
      await db.insert(users).values({
        username: adminUsername,
        email: adminEmail, 
        password: adminPassword,
        displayName: adminUsername,
        mascot: "blue-whale",
        isAdmin: true,
        notificationSettings: { email: true, inApp: true }
      });
      console.log(`Created admin user with email ${adminEmail}`);
    } else {
      // Ensure existing admin has proper privileges
      if (!adminUser.isAdmin) {
        await this.promoteToAdmin(adminUser.id);
        console.log(`Promoted existing user '${adminUser.username}' to admin`);
      }
      
      // Update credentials if environment variables change
      let needsUpdate = false;
      const updates: Partial<User> = {};
      
      if (adminUser.email !== adminEmail) {
        updates.email = adminEmail;
        needsUpdate = true;
      }
      
      // Always update password if ADMIN_PASSWORD is explicitly set (since we'll hash it freshly)
      if (process.env.ADMIN_PASSWORD) {
        console.log("Updating admin password from ADMIN_PASSWORD environment variable");
        updates.password = adminPassword;
        needsUpdate = true;
      } 
      // Or update if ADMIN_PASSWORD_HASH is set and different from current
      else if (process.env.ADMIN_PASSWORD_HASH && adminUser.password !== process.env.ADMIN_PASSWORD_HASH) {
        console.log("Updating admin password from ADMIN_PASSWORD_HASH environment variable");
        updates.password = adminPassword;
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        await db.update(users)
          .set(updates)
          .where(eq(users.id, adminUser.id));
        console.log(`Updated admin credentials for user ${adminUser.username}`);
      }
    }
    
    // Also seed default site configurations
    await this.seedDefaultSiteConfig();
    
    // Also seed some sample competitions if needed
    await this.seedSampleCompetitions();
  }
  
  // Method to seed default site configurations
  async seedDefaultSiteConfig() {
    // Check for siteLogo configuration
    const logoConfig = await this.getSiteConfig("siteLogo");
    if (!logoConfig) {
      // Create empty siteLogo configuration (will be filled by admin later)
      await this.setSiteConfig({
        key: "siteLogo",
        value: "",
        description: "Custom site logo image URL"
      });
    }
  }
  
  // Method to ensure all required tables exist
  async ensureTablesExist() {
    console.log("🔍 Checking if all required database tables exist...");
    
    try {
      // Check if entries table exists
      const entriesTableExists = await this.tableExists("entries");
      if (!entriesTableExists) {
        console.log("⚠️ 'entries' table does not exist. Creating it now...");
        await this.createEntriesTable();
        console.log("✅ 'entries' table created successfully");
      } else {
        console.log("✅ 'entries' table exists");
      }
      
      // Check if winners table exists
      const winnersTableExists = await this.tableExists("winners");
      if (!winnersTableExists) {
        console.log("⚠️ 'winners' table does not exist. Creating it now...");
        await this.createWinnersTable();
        console.log("✅ 'winners' table created successfully");
      } else {
        console.log("✅ 'winners' table exists");
      }
      
      return true;
    } catch (error) {
      console.error("❌ Error ensuring tables exist:", error);
      return false;
    }
  }
  
  // Helper to check if a table exists
  private async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = $1
        )
      `, [tableName]);
      
      return result.rows[0].exists;
    } catch (error) {
      console.error(`❌ Error checking if table ${tableName} exists:`, error);
      return false;
    }
  }
  
  // Create entries table
  private async createEntriesTable(): Promise<boolean> {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS entries (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          competition_id INTEGER NOT NULL,
          ticket_count INTEGER NOT NULL,
          payment_status TEXT NOT NULL,
          stripe_payment_id TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      return true;
    } catch (error) {
      console.error("❌ Error creating entries table:", error);
      return false;
    }
  }
  
  // Create winners table
  private async createWinnersTable(): Promise<boolean> {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS winners (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          competition_id INTEGER NOT NULL,
          entry_id INTEGER,
          announced_at TIMESTAMP DEFAULT NOW(),
          claim_status TEXT NOT NULL
        )
      `);
      return true;
    } catch (error) {
      console.error("❌ Error creating winners table:", error);
      return false;
    }
  }
  
  // Method to seed sample competitions if none exist
  async seedSampleCompetitions() {
    // We no longer seed sample competitions automatically
    // Admin users should create real competitions through the admin interface
    console.log("Skipping sample competition creation - admin should create actual competitions");
  }
}

// Switch from MemStorage to DatabaseStorage for persistence
export const storage = new DatabaseStorage();
