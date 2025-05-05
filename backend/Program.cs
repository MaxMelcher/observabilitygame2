using Azure;
using Azure.AI.OpenAI;
using backend.Data;
using backend.Models;
using Microsoft.ApplicationInsights;
using Microsoft.ApplicationInsights.Extensibility;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;
using OpenAI.Chat;
using Serilog;
using Serilog.Events;
using System.Security.Cryptography;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// Configure Serilog
Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .CreateLogger();

builder.Host.UseSerilog();

// Add services to the container.
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo { Title = "Observability Game API", Version = "v1" });
});
builder.Services.AddApplicationInsightsTelemetry();
builder.Services.AddCors();

// Add database context
builder.Services.AddDbContext<GameDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

// Add Azure OpenAI client
builder.Services.AddSingleton(new AzureOpenAIClient(
    new Uri(builder.Configuration["AzureOpenAI:Endpoint"]!),
    new AzureKeyCredential(builder.Configuration["AzureOpenAI:ApiKey"]!)
));

builder.Services.AddHealthChecks();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseHttpsRedirection();
}
app.UseCors(builder => builder
    .AllowAnyOrigin()
    .AllowAnyMethod()
    .AllowAnyHeader());

// Get top scores
app.MapGet("/api/scores", async (GameDbContext db) =>
{
    return await db.PlayerScores
        .OrderBy(s => s.Time)
        .Take(10)
        .ToListAsync();
})
.WithName("GetTopScores");

//add healthcheck
app.MapHealthChecks("/health");

// Submit new score
app.MapPost("/api/scores", async (GameDbContext db, AzureOpenAIClient openAI, PlayerScore score, ILogger<Program> logger, TelemetryClient telemetryClient) =>
{
    try
    {
        if (score.PlayerName == "crash")
        {
            var crashException = new Exception("GAME SERVER CRASHED!");
            logger.LogCritical(crashException, "Game server crash triggered by user");
            throw crashException;
        }

        if (score.PlayerName == "timeout")
        {
            Thread.Sleep(90000);
            var timeoutException = new Exception("GAME SERVER TIMEOUT!");
            logger.LogCritical(timeoutException, "Game server timeout triggered by user");
            throw timeoutException;
        }

        // Verify hash
        var secretKey = "observability-game-2025"; // In production, this should be in configuration
        var timeStr = score.Time.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture);
        var createdMs = ((DateTimeOffset)score.Created.ToUniversalTime()).ToUnixTimeMilliseconds();
        var payload = $"{score.PlayerName}|{timeStr}|{createdMs}|{secretKey}";
        logger.LogInformation("Backend payload for hash: {Payload}", payload);
        var computedHash = ComputeSha256Hash(payload);
        logger.LogInformation("Backend computed hash: {Hash}, Received hash: {ReceivedHash}", computedHash, score.Hash);

        if (computedHash != score.Hash)
        {
            logger.LogWarning("Invalid hash detected for score submission: {PlayerName}, Expected: {ExpectedHash}, Got: {ReceivedHash}",
                score.PlayerName, computedHash, score.Hash);
            var telemetryProperties = new Dictionary<string, string>
            {
                { "PlayerName", score.PlayerName },
                { "AttemptType", "InvalidHash" }
            };
            telemetryClient.TrackEvent("InvalidHashAttempt", telemetryProperties);
            return Results.BadRequest("nice try! Cheater... :)");
        }

        //validate that the player name is not profane
        var profaneCheckPrompt = $"The following is a player name submitted to a game. Determine if it contains any inappropriate, offensive, profane, harmful, or unsafe content, including insults, hate speech, email addresses, or anything unsuitable for children. Answer strictly with 'yes' or 'no'";
        var chatClient = openAI.GetChatClient("gpt-4o");
        ChatCompletion completion = chatClient.CompleteChat(
            [
                new SystemChatMessage(profaneCheckPrompt),
                new UserChatMessage($"{score.PlayerName}"),
            ]);

        var result = completion.Content[0].Text;

        if (result.ToLower().Contains("yes"))
        {
            // Track the inappropriate username attempt with more detailed telemetry
            logger.LogWarning("Invalid player name attempt: {PlayerName}", score.PlayerName);
            var telemetryProperties = new Dictionary<string, string>
            {
                { "PlayerName", score.PlayerName },
                { "AttemptType", "InappropriateUsername" }
            };
            telemetryClient.TrackEvent("InappropriateUsernameAttempt", telemetryProperties);

            return Results.BadRequest("invalid player name");
        }

        score.Created = DateTime.UtcNow;
        db.PlayerScores.Add(score);
        await db.SaveChangesAsync();

        return Results.Created($"/api/scores/{score.Id}", score);
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error processing score submission");
        return Results.StatusCode(500);
    }
})
.WithName("SubmitScore");

//return 200 on /
app.MapGet("/", () => "Observability Game API is running!");

app.Run();

string ComputeSha256Hash(string rawData)
{
    using (SHA256 sha256Hash = SHA256.Create())
    {
        byte[] bytes = sha256Hash.ComputeHash(Encoding.UTF8.GetBytes(rawData));
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < bytes.Length; i++)
        {
            builder.Append(bytes[i].ToString("x2"));
        }
        return builder.ToString();
    }
}
