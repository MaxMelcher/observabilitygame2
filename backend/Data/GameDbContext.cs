using Microsoft.EntityFrameworkCore;
using backend.Models;

namespace backend.Data;

public class GameDbContext : DbContext
{
    public GameDbContext(DbContextOptions<GameDbContext> options) : base(options)
    {
    }

    public DbSet<PlayerScore> PlayerScores { get; set; }
}