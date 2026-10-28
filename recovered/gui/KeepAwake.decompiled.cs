using System;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32;

[assembly: CompilationRelaxations(8)]
[assembly: RuntimeCompatibility(WrapNonExceptionThrows = true)]
[assembly: AssemblyVersion("0.0.0.0")]
internal static class KeepAwake
{
	private struct LASTINPUTINFO
	{
		public uint cbSize;

		public uint dwTime;
	}

	private struct SYSTEM_POWER_STATUS
	{
		public byte ACLineStatus;

		public byte BatteryFlag;

		public byte BatteryLifePercent;

		public byte Reserved1;

		public int BatteryLifeTime;

		public int BatteryFullLifeTime;
	}

	private struct MOUSEINPUT
	{
		public int dx;

		public int dy;

		public uint mouseData;

		public uint dwFlags;

		public uint time;

		public IntPtr dwExtraInfo;
	}

	private struct INPUT
	{
		public uint type;

		public MOUSEINPUT mi;
	}

	private const uint ES_CONTINUOUS = 2147483648u;

	private const uint ES_SYSTEM_REQUIRED = 1u;

	private const uint ES_DISPLAY_REQUIRED = 2u;

	[DllImport("kernel32.dll")]
	private static extern uint SetThreadExecutionState(uint flags);

	[DllImport("kernel32.dll")]
	private static extern bool GetSystemPowerStatus(ref SYSTEM_POWER_STATUS sps);

	[DllImport("user32.dll")]
	private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

	[DllImport("user32.dll")]
	private static extern uint SendInput(uint n, INPUT[] p, int size);

	[DllImport("kernel32.dll")]
	private static extern bool AllocConsole();

	private static int GetCfgInt(string name, int def)
	{
		try
		{
			RegistryKey registryKey = Registry.CurrentUser.OpenSubKey("Software\\KeepAwakeTool");
			if (registryKey == null)
			{
				return def;
			}
			object value = registryKey.GetValue(name);
			registryKey.Close();
			if (!(value is int result))
			{
				if (value != null && int.TryParse(value.ToString(), out var result2))
				{
					return result2;
				}
				return def;
			}
			return result;
		}
		catch
		{
			return def;
		}
	}

	private static uint IdleSeconds()
	{
		LASTINPUTINFO plii = new LASTINPUTINFO
		{
			cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO))
		};
		if (!GetLastInputInfo(ref plii))
		{
			return 0u;
		}
		return (uint)(Environment.TickCount - (int)plii.dwTime) / 1000u;
	}

	private static void ZeroInput()
	{
		INPUT[] array = new INPUT[1];
		array[0].type = 0u;
		array[0].mi.dx = 0;
		array[0].mi.dy = 0;
		array[0].mi.dwFlags = 1u;
		SendInput(1u, array, Marshal.SizeOf(typeof(INPUT)));
	}

	[STAThread]
	private static int Main(string[] args)
	{
		bool flag = false;
		foreach (string text in args)
		{
			if (text.Equals("/console", StringComparison.OrdinalIgnoreCase))
			{
				flag = true;
			}
		}
		bool createdNew;
		Mutex mutex = new Mutex(initiallyOwned: true, "KeepAwakeTool_SingleInstance", out createdNew);
		if (!createdNew)
		{
			return 0;
		}
		if (flag)
		{
			AllocConsole();
		}
		SetThreadExecutionState(2147483651u);
		DateTime utcNow = DateTime.UtcNow;
		while (true)
		{
			bool flag2 = true;
			int cfgInt = GetCfgInt("PollSeconds", 55);
			int cfgInt2 = GetCfgInt("BreakOnBattery", 1);
			int cfgInt3 = GetCfgInt("InputSim", 1);
			SetThreadExecutionState(2147483651u);
			if (cfgInt3 == 1)
			{
				ZeroInput();
			}
			SYSTEM_POWER_STATUS sps = default(SYSTEM_POWER_STATUS);
			bool flag3 = GetSystemPowerStatus(ref sps) && sps.ACLineStatus == 1;
			uint num = IdleSeconds();
			if (cfgInt2 == 1 && !flag3 && num >= (uint)cfgInt && (DateTime.UtcNow - utcNow).TotalSeconds >= 60.0)
			{
				SetThreadExecutionState(2147483648u);
				Thread.Sleep(3000);
				SetThreadExecutionState(2147483651u);
				utcNow = DateTime.UtcNow;
			}
			if (flag)
			{
				Console.WriteLine("[{0:HH:mm:ss}] {1} | idle={2}s | keep-awake active", DateTime.Now, flag3 ? "AC POWER" : "BATTERY ", num);
			}
			Thread.Sleep(Math.Max(5, cfgInt) * 1000);
		}
	}
}
