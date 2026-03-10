import { gameConfig } from "../config/gameConfig.js";
import { CountryRegistry } from "../modules/world/CountryRegistry.js";
import { WorldState } from "../modules/world/WorldState.js";
import { AuthService } from "../modules/auth/AuthService.js";
import { SocialService } from "../modules/social/SocialService.js";
import { GameShell } from "../modules/ui/GameShell.js";

export class Game {
  constructor() {
    this.countryRegistry = new CountryRegistry();
    this.worldState = new WorldState(this.countryRegistry.getAll());
    this.authService = new AuthService();
    this.socialService = new SocialService();
    this.ui = new GameShell(gameConfig, this.worldState, this.authService, this.socialService);
  }

  async start() {
    await this.ui.render();
  }
}