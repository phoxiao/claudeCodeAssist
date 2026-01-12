import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MarketplaceSkill } from './sources';

interface FavoritesData {
    version: number;
    favorites: FavoriteItem[];
}

export interface FavoriteItem {
    name: string;
    url: string;
    type: 'skill' | 'agent' | 'plugin';
    description: string;
    author?: string;
    addedAt: string;
}

export class FavoritesManager {
    private favoritesPath: string;
    private favorites: FavoriteItem[] = [];

    constructor() {
        const claudeDir = path.join(os.homedir(), '.claude');
        if (!fs.existsSync(claudeDir)) {
            fs.mkdirSync(claudeDir, { recursive: true });
        }
        this.favoritesPath = path.join(claudeDir, 'favorites.json');
        this.load();
    }

    private load(): void {
        try {
            if (fs.existsSync(this.favoritesPath)) {
                const content = fs.readFileSync(this.favoritesPath, 'utf-8');
                const data: FavoritesData = JSON.parse(content);
                this.favorites = data.favorites || [];
            }
        } catch (error) {
            console.error('Failed to load favorites:', error);
            this.favorites = [];
        }
    }

    private save(): void {
        try {
            const data: FavoritesData = {
                version: 1,
                favorites: this.favorites
            };
            fs.writeFileSync(this.favoritesPath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (error) {
            console.error('Failed to save favorites:', error);
        }
    }

    /**
     * Add a skill to favorites
     */
    add(skill: MarketplaceSkill): boolean {
        if (this.isFavorite(skill.url)) {
            return false;
        }

        this.favorites.push({
            name: skill.name,
            url: skill.url,
            type: skill.type,
            description: skill.description,
            author: skill.author,
            addedAt: new Date().toISOString()
        });

        this.save();
        return true;
    }

    /**
     * Remove a skill from favorites
     */
    remove(url: string): boolean {
        const index = this.favorites.findIndex(f => f.url === url);
        if (index === -1) {
            return false;
        }

        this.favorites.splice(index, 1);
        this.save();
        return true;
    }

    /**
     * Toggle favorite status
     */
    toggle(skill: MarketplaceSkill): boolean {
        if (this.isFavorite(skill.url)) {
            this.remove(skill.url);
            return false;
        } else {
            this.add(skill);
            return true;
        }
    }

    /**
     * Check if a skill is favorited
     */
    isFavorite(url: string): boolean {
        return this.favorites.some(f => f.url === url);
    }

    /**
     * Get all favorites
     */
    getAll(): FavoriteItem[] {
        return [...this.favorites];
    }

    /**
     * Get favorites as MarketplaceSkill format
     */
    getAllAsSkills(): MarketplaceSkill[] {
        return this.favorites.map(f => ({
            name: f.name,
            url: f.url,
            type: f.type,
            description: f.description,
            author: f.author,
            source: 'favorites'
        }));
    }

    /**
     * Clear all favorites
     */
    clear(): void {
        this.favorites = [];
        this.save();
    }

    /**
     * Get count of favorites
     */
    count(): number {
        return this.favorites.length;
    }
}

// Singleton instance
let instance: FavoritesManager | null = null;

export function getFavoritesManager(): FavoritesManager {
    if (!instance) {
        instance = new FavoritesManager();
    }
    return instance;
}
